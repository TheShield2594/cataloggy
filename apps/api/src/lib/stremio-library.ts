import { prisma } from "./prisma.js";
import { recordWatchEvent } from "./watch-event.js";
import { SECRET_CONTEXT, decryptSecret, encryptSecret } from "./secret-box.js";
import { StremioClient, StremioApiError, isAuthError, getStremioApiBase } from "../stremio-api.js";
import type { StremioLibraryItem } from "../stremio-api.js";
import type { FastifyBaseLogger } from "fastify";

const AUTH_ROW_ID = "default";
const LIBRARY_COLLECTION = "libraryItem";

/**
 * Per-item watermark: `{ [libraryItemId]: { m: mtime, s: watchSignature } }`.
 *
 * `m` is Stremio's own mtime and only decides whether an item is worth
 * *fetching*. `s` decides whether it is worth *recording* — it is derived
 * purely from the fields that change when a watch happens, never from playback
 * progress. Without that split, every progress tick during playback would look
 * like a fresh watch and inflate the play count on a 2-minute timer.
 */
const WATERMARK_KEY = "stremio:libraryWatermark";

const IMDB_ID_PATTERN = /^tt\d+$/;
const DATASTORE_GET_CHUNK = 200;

export type StremioSyncSummary = {
  scanned: number;
  fetched: number;
  recorded: number;
  skipped: number;
};

type Watermark = Record<string, { m: string; s: string }>;

type StremioWatch =
  | { kind: "movie"; imdbId: string; watchedAt: Date }
  | { kind: "episode"; seriesImdbId: string; season: number; episode: number; watchedAt: Date };

/**
 * "baseline" learns the current state without recording anything — used when an
 * account is first connected, so switching the feature on doesn't dump a whole
 * Stremio library into the history as if it had all just been watched.
 * "import" is the deliberate one-time backfill. "incremental" is the poller.
 */
export type StremioSyncMode = "baseline" | "import" | "incremental";

let client: StremioClient | null = null;

export const getStremioClient = (): StremioClient => {
  client ??= new StremioClient();
  return client;
};

export const resetStremioClient = () => {
  client = null;
};

export const isStremioConnected = async (): Promise<boolean> =>
  !!(await prisma.stremioAuth.findUnique({ where: { id: AUTH_ROW_ID } }));

export const getStremioStatus = async (): Promise<{
  connected: boolean;
  email: string | null;
  apiBase: string | null;
  connectedAt: string | null;
}> => {
  const row = await prisma.stremioAuth.findUnique({ where: { id: AUTH_ROW_ID } });
  // A rejected base (non-HTTPS, unparseable) must not take the status route
  // down with it — reporting it as absent is what lets Settings stay usable
  // long enough to see something is wrong.
  let apiBase: string | null;
  try {
    apiBase = getStremioApiBase();
  } catch {
    apiBase = null;
  }
  return {
    connected: !!row,
    email: row?.email ?? null,
    apiBase,
    connectedAt: row?.updatedAt.toISOString() ?? null,
  };
};

/**
 * Exchanges credentials for an authKey and stores only that. The password is
 * never written anywhere — not to the database, not to the log.
 *
 * Callers follow this with a "baseline" sync, so the first scheduled poll
 * reports only what happens *after* connecting; existing history comes in
 * through the explicit import instead.
 */
export const connectStremio = async (
  email: string,
  password: string,
  profileId: string,
  logger: FastifyBaseLogger
): Promise<void> => {
  const authKey = encryptSecret(
    SECRET_CONTEXT.stremioAuthKey,
    await getStremioClient().login(email, password, logger)
  );
  await prisma.stremioAuth.upsert({
    where: { id: AUTH_ROW_ID },
    create: { id: AUTH_ROW_ID, authKey, email, profileId },
    update: { authKey, email, profileId },
  });
  logger.info({ email, profileId }, "Stremio account connected");
};

/**
 * The profile the connected account belongs to, for callers with no request to
 * resolve one from. Null when nothing is connected, or when the row predates
 * the column — the scheduler then falls back to the default profile, which is
 * what it did before.
 */
export const getStremioProfileId = async (): Promise<string | null> => {
  const row = await prisma.stremioAuth.findUnique({ where: { id: AUTH_ROW_ID } });
  return row?.profileId ?? null;
};

export const disconnectStremio = async (): Promise<void> => {
  await prisma.stremioAuth.deleteMany({ where: { id: AUTH_ROW_ID } });
  await prisma.kV.deleteMany({ where: { key: WATERMARK_KEY } });
};

const readWatermark = async (): Promise<Watermark | null> => {
  const row = await prisma.kV.findUnique({ where: { key: WATERMARK_KEY } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Watermark) : null;
  } catch {
    return null;
  }
};

/**
 * Serializes every pass through the library.
 *
 * A pass is a read-modify-write over one watermark row with network calls in
 * the middle, so two overlapping passes — the scheduled poll meeting a manual
 * "Sync now" or an import — would both read the same pre-state, both decide the
 * same items are new, and both record them. That is precisely the duplicate the
 * signature scheme exists to prevent, so the whole pass is taken under a lock
 * rather than trying to make the watermark write conditional.
 *
 * Callers queue rather than bail: an import must not be silently skipped just
 * because a poll happened to be in flight.
 */
let syncChain: Promise<unknown> = Promise.resolve();

const withSyncLock = <T>(run: () => Promise<T>): Promise<T> => {
  // `.then(run, run)` so a failed pass never wedges the queue behind it.
  const next = syncChain.then(run, run);
  syncChain = next.catch(() => undefined);
  return next;
};

const writeWatermark = async (watermark: Watermark): Promise<void> => {
  const value = JSON.stringify(watermark);
  const now = new Date();
  await prisma.kV.upsert({
    where: { key: WATERMARK_KEY },
    create: { key: WATERMARK_KEY, value, updatedAt: now },
    update: { value, updatedAt: now },
  });
};

/**
 * A `video_id` looks like "tt0903747:1:7". Only ids whose series part matches
 * the library item itself are accepted — a mismatch means an addon numbering
 * scheme this can't reason about, and guessing would write the wrong episode.
 */
const parseEpisodeRef = (
  itemId: string,
  state: NonNullable<StremioLibraryItem["state"]>
): { season: number; episode: number } | null => {
  const videoId = typeof state.video_id === "string" ? state.video_id : null;
  if (videoId) {
    const parts = videoId.split(":");
    // A video_id naming a *different* series is the one case where the
    // season/episode fallback must not run: those numbers describe the foreign
    // id, so using them would file someone else's episode under this series.
    // Bail out entirely rather than fall through.
    if (parts.length !== 3 || parts[0] !== itemId) return null;

    const season = Number.parseInt(parts[1], 10);
    const episode = Number.parseInt(parts[2], 10);
    if (Number.isInteger(season) && Number.isInteger(episode) && season >= 0 && episode >= 0) {
      return { season, episode };
    }
  }

  const season = typeof state.season === "number" ? state.season : null;
  const episode = typeof state.episode === "number" ? state.episode : null;
  if (Number.isInteger(season) && Number.isInteger(episode) && season! >= 0 && episode! >= 0) {
    return { season: season!, episode: episode! };
  }
  return null;
};

/**
 * Stremio timestamps are ISO strings, but a never-played item can carry a zero
 * date and a clock-skewed client can carry a future one. Anything outside a
 * sane window falls back to now rather than writing a nonsense watch date.
 */
const parseWatchedAt = (state: NonNullable<StremioLibraryItem["state"]>, mtime: string | null): Date => {
  const candidates = [state.lastWatched, mtime];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const parsed = new Date(candidate);
    const time = parsed.getTime();
    if (!Number.isFinite(time)) continue;
    // At or before the Unix epoch: either a pre-epoch date, or the zero
    // timestamp Stremio uses to mean "never". Everything after it, January 1970
    // included, is a real date. (Date.UTC months are zero-based, so the obvious
    // spelling of "1 Jan 1970" reads as 1 February and throws January away.)
    if (time <= 0) continue;
    if (time > Date.now() + 24 * 60 * 60 * 1000) continue;
    return parsed;
  }
  return new Date();
};

const isWatched = (state: NonNullable<StremioLibraryItem["state"]>): boolean => {
  if (state.flaggedWatched === 1) return true;
  return typeof state.timesWatched === "number" && state.timesWatched >= 1;
};

/**
 * The recording key for an item, or null when there is nothing watched to
 * record. Deliberately excludes `timeOffset`/`lastWatched`, which change
 * continuously during playback.
 *
 * Movies key on the play counter so a genuine re-watch registers as another
 * play. Episodes key on the episode identity only: moving to a new episode is a
 * new watch, but a re-watch of the same one is not re-recorded. Under-counting a
 * repeat is a much cheaper mistake than inventing plays on a timer.
 */
const watchSignature = (item: StremioLibraryItem, watch: StremioWatch): string =>
  watch.kind === "movie"
    ? `m|${item.state?.timesWatched ?? 0}|${item.state?.flaggedWatched ?? 0}`
    : `e|${watch.season}|${watch.episode}`;

const extractWatch = (item: StremioLibraryItem): StremioWatch | null => {
  const id = typeof item._id === "string" ? item._id.trim() : "";
  // Only IMDb-keyed content maps onto Cataloggy's library. Items from addons
  // with their own id namespaces (and Stremio's live-TV entries) are skipped
  // rather than guessed at.
  if (!IMDB_ID_PATTERN.test(id)) return null;

  const state = item.state;
  if (!state || typeof state !== "object") return null;
  if (!isWatched(state)) return null;

  const watchedAt = parseWatchedAt(state, typeof item._mtime === "string" ? item._mtime : null);

  if (item.type === "movie") {
    return { kind: "movie", imdbId: id, watchedAt };
  }

  if (item.type === "series") {
    const ref = parseEpisodeRef(id, state);
    if (!ref) return null;
    return { kind: "episode", seriesImdbId: id, season: ref.season, episode: ref.episode, watchedAt };
  }

  return null;
};

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Reads watched state from the connected Stremio account and records it locally.
 *
 * Every signed-in Stremio client — desktop, mobile, Android TV, the web app, and
 * the third-party clients that sign in with a Stremio account — syncs to this
 * same library, so one connection covers all of them without any per-client
 * setup.
 *
 * The incremental path costs a single small `datastoreMeta` call when nothing
 * has been watched, which is what makes a short poll interval reasonable.
 */
export const syncStremioLibrary = (
  logger: FastifyBaseLogger,
  profileId: string,
  mode: StremioSyncMode = "incremental"
): Promise<StremioSyncSummary> => withSyncLock(() => runSync(logger, profileId, mode));

const runSync = async (
  logger: FastifyBaseLogger,
  profileId: string,
  mode: StremioSyncMode
): Promise<StremioSyncSummary> => {
  const summary: StremioSyncSummary = { scanned: 0, fetched: 0, recorded: 0, skipped: 0 };

  const auth = await prisma.stremioAuth.findUnique({ where: { id: AUTH_ROW_ID } });
  if (!auth) return summary;

  const authKey = decryptSecret(SECRET_CONTEXT.stremioAuthKey, auth.authKey);
  if (authKey === null) {
    // Not "nothing connected" — the row is there and Settings will keep saying
    // connected, so this has to be loud enough to reach Sync Status rather than
    // returning an empty summary that reads like a quiet, successful poll.
    throw new Error(
      "Stored Stremio access key could not be decrypted — API_TOKEN has changed since it was saved. Reconnect the Stremio account from Settings."
    );
  }

  const stremio = getStremioClient();
  const previous = (await readWatermark()) ?? {};
  const isFullPass = mode === "import" || mode === "baseline";

  let items: StremioLibraryItem[];
  const watermark: Watermark = {};
  // The mtime a *changed* item should be watermarked under, keyed by id.
  //
  // Comparison and storage have to draw on the same clock. `datastoreMeta` and
  // an item's own `_mtime` are different representations, so watermarking a
  // fetched item under `_mtime` would guarantee the next pass's meta comparison
  // never matched — every item re-fetched, every poll, which is exactly the
  // cost the incremental path exists to avoid.
  const metaMtimes = new Map<string, string>();

  try {
    if (isFullPass) {
      items = await stremio.datastoreGet(authKey, LIBRARY_COLLECTION, null, logger);
      summary.scanned = items.length;
      summary.fetched = items.length;
    } else {
      const meta = await stremio.datastoreMeta(authKey, LIBRARY_COLLECTION, logger);
      summary.scanned = meta.length;

      const changedIds: string[] = [];
      for (const [id, mtime] of meta) {
        const mtimeKey = String(mtime);
        metaMtimes.set(id, mtimeKey);
        const seen = previous[id];
        if (seen && seen.m === mtimeKey) {
          // Unchanged since last sync — carry the watermark forward untouched
          // and never fetch the item at all.
          watermark[id] = seen;
          continue;
        }
        changedIds.push(id);
      }

      if (changedIds.length === 0) {
        await writeWatermark(watermark);
        return summary;
      }

      items = [];
      for (const ids of chunk(changedIds, DATASTORE_GET_CHUNK)) {
        items.push(...(await stremio.datastoreGet(authKey, LIBRARY_COLLECTION, ids, logger)));
      }
      summary.fetched = items.length;
    }
  } catch (error) {
    if (isAuthError(error)) {
      logger.warn("Stremio authKey was rejected — the account needs reconnecting");
    }
    throw error;
  }

  for (const item of items) {
    const id = typeof item._id === "string" ? item._id.trim() : "";
    if (!id) continue;
    // A full pass makes no `datastoreMeta` call, so `_mtime` is all there is;
    // the first incremental pass after one re-fetches everything once and is
    // consistent from then on.
    const mtimeKey = metaMtimes.get(id) ?? String(item._mtime ?? "");

    const watch = extractWatch(item);
    if (!watch) {
      // Still watermarked, so an item with nothing to record isn't re-fetched
      // on every single poll.
      watermark[id] = { m: mtimeKey, s: previous[id]?.s ?? "" };
      summary.skipped += 1;
      continue;
    }

    const signature = watchSignature(item, watch);
    if (previous[id]?.s === signature) {
      watermark[id] = { m: mtimeKey, s: signature };
      summary.skipped += 1;
      continue;
    }

    if (mode === "baseline") {
      watermark[id] = { m: mtimeKey, s: signature };
      continue;
    }

    try {
      if (watch.kind === "movie") {
        await recordWatchEvent({
          type: "movie",
          imdbId: watch.imdbId,
          watchedAt: watch.watchedAt,
          source: "Stremio",
          profileId,
          log: logger,
        });
      } else {
        await recordWatchEvent({
          type: "episode",
          imdbId: watch.seriesImdbId,
          seriesImdbId: watch.seriesImdbId,
          season: watch.season,
          episode: watch.episode,
          watchedAt: watch.watchedAt,
          source: "Stremio",
          profileId,
          log: logger,
        });
      }
      summary.recorded += 1;
      watermark[id] = { m: mtimeKey, s: signature };
    } catch (error) {
      // Leave this item out of the watermark entirely so the next run retries
      // it, and keep going — one unmappable title must not stall the sync.
      logger.warn({ error, id }, "Failed to record a watch from the Stremio library");
    }
  }

  await writeWatermark(watermark);
  logger.info(summary, `Stremio library sync (${mode}) complete`);
  return summary;
};

export { StremioApiError };
