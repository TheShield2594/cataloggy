import { ItemType, ListItemType, Prisma } from "@prisma/client";
import {
  TraktClient,
  computeTokenExpiresAt,
  type TraktScrobblePayload,
  type TraktWatchlistMutationPayload,
} from "../trakt.js";
import { prisma } from "./prisma.js";
import { upsertSeriesProgressIfNewer } from "./series-progress.js";
import { getDefaultWatchlist } from "./watchlist.js";
import { watchEventDedupWhere, type WatchEventDedupKey } from "./watch-event-dedup.js";
import type { SeriesProgressCandidate } from "./types.js";
import type { FastifyRequest } from "fastify";

export { computeTokenExpiresAt };

let traktClient: TraktClient | null = null;

export const getTraktClient = async (): Promise<TraktClient> => {
  if (!traktClient) {
    traktClient = await TraktClient.create(prisma);
  }
  return traktClient;
};

export const resetTraktClient = () => {
  traktClient = null;
};

export const isTraktConnected = async (): Promise<boolean> => {
  if (!process.env.TRAKT_CLIENT_ID?.trim() || !process.env.TRAKT_CLIENT_SECRET?.trim()) return false;
  const token = await prisma.traktToken.findUnique({ where: { id: "default" } });
  return !!token;
};

export type TraktScrobbleAction = "start" | "pause" | "stop";

export type TraktScrobbleParams = {
  type: "movie" | "episode";
  imdbId: string;
  seriesImdbId?: string | null;
  season?: number | null;
  episode?: number | null;
  progress: number;
};

/**
 * Pushes a live playback transition to Trakt, mirroring what Trakt's own
 * apps/plugins do. Best-effort: never throws, returns null on any failure
 * or when Trakt isn't connected. On "stop", a non-null return is the Trakt
 * history id created for the watch (only when progress crossed Trakt's own
 * completion threshold).
 */
export const pushTraktScrobble = async (
  action: TraktScrobbleAction,
  params: TraktScrobbleParams,
  logger: FastifyRequest["log"]
): Promise<bigint | null> => {
  if (params.type === "episode" && (params.season == null || params.episode == null)) return null;
  if (!(await isTraktConnected())) return null;

  try {
    const client = await getTraktClient();
    const progress = Math.max(0, Math.min(100, Math.round(params.progress)));

    const payload: TraktScrobblePayload =
      params.type === "movie"
        ? { movie: { ids: { imdb: params.imdbId } }, progress }
        : {
            show: { ids: { imdb: params.seriesImdbId ?? params.imdbId } },
            episode: { season: params.season as number, number: params.episode as number },
            progress
          };

    const response =
      action === "start"
        ? await client.scrobbleStart(payload, logger)
        : action === "pause"
          ? await client.scrobblePause(payload, logger)
          : await client.scrobbleStop(payload, logger);

    return response.id != null ? BigInt(response.id) : null;
  } catch (error) {
    logger.warn({ error, action }, "Trakt scrobble push failed");
    return null;
  }
};

/**
 * Fire-and-forget: pushes a completed watch to Trakt's history (if not
 * already synced) and persists the returned Trakt history id, so a later
 * pollTraktHistory() run recognizes it and doesn't import it as a duplicate.
 */
export const syncWatchEventToTrakt = (
  watchEvent: { id: string; traktHistoryId: bigint | null },
  params: { type: "movie" | "episode"; imdbId: string; seriesImdbId?: string | null; season?: number | null; episode?: number | null },
  logger: FastifyRequest["log"]
): void => {
  if (watchEvent.traktHistoryId != null) return;

  void (async () => {
    const historyId = await pushTraktScrobble("stop", { ...params, progress: 100 }, logger);
    if (historyId == null) return;
    try {
      await prisma.watchEvent.update({ where: { id: watchEvent.id }, data: { traktHistoryId: historyId } });
    } catch (error) {
      logger.warn({ error }, "Failed to persist Trakt history id on watch event");
    }
  })();
};

export type WatchlistItemRef = { type: "movie" | "series"; imdbId: string };

const toTraktWatchlistPayload = (item: WatchlistItemRef): TraktWatchlistMutationPayload =>
  item.type === "movie"
    ? { movies: [{ ids: { imdb: item.imdbId } }] }
    : { shows: [{ ids: { imdb: item.imdbId } }] };

/**
 * Best-effort: pushes a single watchlist add/remove to Trakt. Never throws,
 * no-ops when Trakt isn't connected.
 */
export const pushTraktWatchlistChange = async (
  action: "add" | "remove",
  item: WatchlistItemRef,
  logger: FastifyRequest["log"]
): Promise<void> => {
  if (!(await isTraktConnected())) return;

  try {
    const client = await getTraktClient();
    const payload = toTraktWatchlistPayload(item);
    if (action === "add") {
      await client.addToWatchlist(payload, logger);
    } else {
      await client.removeFromWatchlist(payload, logger);
    }
  } catch (error) {
    logger.warn({ error, action, item }, "Trakt watchlist push failed");
  }
};

const TRAKT_WATCHLIST_SNAPSHOT_KEY = "trakt:watchlistSnapshot";

/**
 * Whether a removal on Trakt is allowed to remove the item locally too.
 *
 * Off by default: Trakt is an optional mirror, not the system of record. A
 * self-hoster's library should never shrink because a third-party service
 * decided it should — least of all one they are keeping at arm's length
 * precisely because it might go away.
 *
 * Turning this on restores the old two-way behaviour for anyone who does want
 * Trakt driving their watchlist.
 */
const TRAKT_WATCHLIST_MIRROR_DELETES = process.env.TRAKT_WATCHLIST_MIRROR_DELETES?.trim() === "true";

const watchlistSnapshotKey = (item: WatchlistItemRef) => `${item.type}:${item.imdbId}`;

const readWatchlistSnapshot = async (): Promise<Set<string> | null> => {
  const row = await prisma.kV.findUnique({ where: { key: TRAKT_WATCHLIST_SNAPSHOT_KEY } });
  if (!row) return null;
  try {
    return new Set(JSON.parse(row.value) as string[]);
  } catch {
    return null;
  }
};

const writeWatchlistSnapshot = async (keys: Set<string>): Promise<void> => {
  const value = JSON.stringify([...keys]);
  await prisma.kV.upsert({
    where: { key: TRAKT_WATCHLIST_SNAPSHOT_KEY },
    create: { key: TRAKT_WATCHLIST_SNAPSHOT_KEY, value, updatedAt: new Date() },
    update: { value, updatedAt: new Date() },
  });
};

/**
 * Reconciliation between Trakt's watchlist and the local default watchlist.
 * Items present on Trakt but missing locally are added. Local items that were
 * never confirmed on Trakt (e.g. a push that failed at add-time) are retried
 * instead of deleted, so a transient failure can't silently drop an item.
 *
 * Items that disappeared from Trakt since the last sync are only removed
 * locally when TRAKT_WATCHLIST_MIRROR_DELETES is on; otherwise they are kept
 * and counted in `keptLocally`. See that constant for why off is the default.
 */
export const syncTraktWatchlist = async (
  logger: FastifyRequest["log"],
  profileId: string
): Promise<{
  addedLocally: number;
  removedLocally: number;
  keptLocally: number;
  pushedToTrakt: number;
}> => {
  if (!(await isTraktConnected())) {
    return { addedLocally: 0, removedLocally: 0, keptLocally: 0, pushedToTrakt: 0 };
  }

  const client = await getTraktClient();
  const [watchlistMovies, watchlistShows] = await Promise.all([
    client.fetchWatchlistMovies(logger),
    client.fetchWatchlistShows(logger),
  ]);

  const traktItems: WatchlistItemRef[] = [
    ...watchlistMovies
      .map((e) => e.movie?.ids?.imdb)
      .filter((id): id is string => !!id)
      .map((imdbId) => ({ type: "movie" as const, imdbId })),
    ...watchlistShows
      .map((e) => e.show?.ids?.imdb)
      .filter((id): id is string => !!id)
      .map((imdbId) => ({ type: "series" as const, imdbId })),
  ];
  const traktKeys = new Set(traktItems.map(watchlistSnapshotKey));

  const previousSnapshot = await readWatchlistSnapshot();

  const watchlist = await getDefaultWatchlist(profileId);
  const localItems = await prisma.listItem.findMany({ where: { listId: watchlist.id } });
  const localByKey = new Map(localItems.map((item) => [`${item.type}:${item.imdbId}`, item]));

  // Keys that were on Trakt and locally last sync, are still on Trakt now, but
  // are no longer present locally: a local removal whose push to Trakt must
  // have failed. Without this check, the loop below would treat them as new
  // Trakt-side adds and silently resurrect the item the user just removed.
  const pendingRemovalRetryKeys = previousSnapshot
    ? new Set([...previousSnapshot].filter((key) => traktKeys.has(key) && !localByKey.has(key)))
    : new Set<string>();

  // A Trakt watchlist that has gone *entirely* empty since the last sync is far
  // more likely to be a service that broke, an account that was reset, or a
  // token now pointing somewhere else than a user who deliberately cleared
  // every item. Errors can't reach this point (the client throws on any
  // non-2xx), but a healthy-looking 200 carrying `[]` can — and honouring it
  // would empty the local watchlist too. Refuse the whole deletion pass in that
  // case, whatever TRAKT_WATCHLIST_MIRROR_DELETES says.
  const traktWentEmpty = traktKeys.size === 0 && !!previousSnapshot && previousSnapshot.size > 0;
  if (traktWentEmpty) {
    logger.warn(
      { previouslyOnTrakt: previousSnapshot.size },
      "Trakt returned an empty watchlist where it previously had items — skipping mirror deletions"
    );
  }
  const mirrorDeletes = TRAKT_WATCHLIST_MIRROR_DELETES && !traktWentEmpty;

  let addedLocally = 0;
  let removedLocally = 0;
  let keptLocally = 0;
  let pushedToTrakt = 0;

  for (const item of traktItems) {
    const key = watchlistSnapshotKey(item);
    if (localByKey.has(key)) continue;

    if (pendingRemovalRetryKeys.has(key)) {
      await pushTraktWatchlistChange("remove", item, logger);
      pushedToTrakt += 1;
      continue;
    }

    const itemType = item.type === "movie" ? ItemType.movie : ItemType.series;
    await prisma.item.upsert({
      where: { type_imdbId: { type: itemType, imdbId: item.imdbId } },
      create: { type: itemType, imdbId: item.imdbId },
      update: {},
    });

    try {
      await prisma.listItem.create({
        data: { listId: watchlist.id, type: item.type as ListItemType, imdbId: item.imdbId },
      });
      addedLocally += 1;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }

  // Items kept locally despite being gone from Trakt. They are written into the
  // snapshot alongside the live Trakt keys so the next run still classifies them
  // as "was on Trakt, isn't now" and keeps them again. Leaving them out would
  // make the next run read them as a local add that never reached Trakt and
  // push them straight back up — resurrecting on Trakt exactly what the user
  // removed there.
  const keptKeys = new Set<string>();

  if (previousSnapshot) {
    for (const [key, item] of localByKey) {
      if (traktKeys.has(key)) continue;

      if (previousSnapshot.has(key)) {
        if (!mirrorDeletes) {
          keptKeys.add(key);
          keptLocally += 1;
          continue;
        }
        await prisma.listItem.delete({
          where: { listId_type_imdbId: { listId: item.listId, type: item.type, imdbId: item.imdbId } },
        });
        removedLocally += 1;
      } else {
        await pushTraktWatchlistChange(
          "add",
          { type: item.type as "movie" | "series", imdbId: item.imdbId },
          logger
        );
        pushedToTrakt += 1;
      }
    }
  }

  await writeWatchlistSnapshot(new Set([...traktKeys, ...keptKeys]));

  return { addedLocally, removedLocally, keptLocally, pushedToTrakt };
};

export const TRAKT_LAST_POLLED_AT_KEY = "trakt:lastPolledAt";

/**
 * Set once the account's full history has been imported at least once.
 *
 * Separate from the watermark above because the two answer different
 * questions. An install that has been polling since before backfills existed
 * has a watermark — it just never covered anything before it — so the
 * watermark alone can't distinguish "up to date" from "up to date since the
 * week it was connected". Absent marker means the history was never imported
 * in full, whatever the watermark says, and the next poll fixes that.
 */
export const TRAKT_HISTORY_BACKFILLED_AT_KEY = "trakt:historyBackfilledAt";

const hasCompletedBackfill = async (): Promise<boolean> =>
  !!(await prisma.kV.findUnique({ where: { key: TRAKT_HISTORY_BACKFILLED_AT_KEY } }));

/**
 * Where the next history poll starts, or `null` for "no lower bound — import
 * everything Trakt has".
 *
 * A missing or unreadable watermark means this install has never successfully
 * imported history, so the only safe answer is the whole account. The previous
 * 7-day default quietly made the first sync a *window*: everything watched
 * before that week never arrived, and because the poll then wrote a watermark,
 * no later run ever went back for it — leaving a library that looks like it
 * only ever contained the last month.
 */
const getTraktPollStartAt = async (): Promise<Date | null> => {
  const kvValue = await prisma.kV.findUnique({ where: { key: TRAKT_LAST_POLLED_AT_KEY } });

  if (!kvValue) return null;

  const parsed = new Date(kvValue.value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed;
};

/**
 * Imports Trakt play history into watch events.
 *
 * Incremental by default (from the last successful poll), but runs as a
 * complete backfill whenever this install has never imported the full history
 * — including installs upgraded from the version that only ever fetched a
 * 7-day window, which heal on their next poll without anyone having to know
 * that's what they need. Pass `{ full: true }` to force one regardless.
 */
export const pollTraktHistory = async (
  logger: FastifyRequest["log"],
  profileId: string,
  options: { full?: boolean } = {}
) => {
  // Disconnecting Trakt is a supported ending, not a fault. Without this the
  // scheduled poll keeps running against a token that no longer exists, throws
  // every interval, and files a recurring failure in Settings → Sync Status —
  // so leaving Trakt looks like something broke. Every other Trakt entry point
  // in this file already checks first.
  if (!(await isTraktConnected())) {
    return {
      since: null,
      fullBackfill: false,
      polledAt: new Date().toISOString(),
      importedWatchEvents: { movies: 0, episodes: 0 },
      updatedSeriesProgress: 0,
    };
  }

  const client = await getTraktClient();
  const pollStartAt =
    options.full || !(await hasCompletedBackfill()) ? null : await getTraktPollStartAt();
  const pollCompletedAt = new Date();
  const pollStartAtIso = pollStartAt?.toISOString();
  const isBackfill = pollStartAtIso === undefined;

  if (isBackfill) {
    logger.info("Trakt history poll running as a full backfill — importing the account's entire history");
  }

  const [movieHistory, episodeHistory] = await Promise.all([
    client.fetchMovieHistory(logger, pollStartAtIso),
    client.fetchEpisodeHistory(logger, pollStartAtIso),
  ]);

  const importedWatchEvents = { movies: 0, episodes: 0 };
  const seriesProgressByImdb = new Map<string, SeriesProgressCandidate>();
  // One title upsert per item rather than per play. A backfill can carry
  // hundreds of plays of the same show, and each upsert is a database round
  // trip that writes the value already there.
  const upsertedTitles = new Set<string>();

  // How many plays this run carries for each item, counted before anything is
  // written. A row's aggregate play count may only be dropped when the backfill
  // is bringing at least that many individual plays in to replace it — see
  // reconcileExistingEvent.
  const playsInThisRun = new Map<string, number>();
  if (isBackfill) {
    for (const entry of movieHistory) {
      const imdbId = entry.movie?.ids?.imdb;
      if (!imdbId || !entry.watched_at) continue;
      const key = `movie:${imdbId}`;
      playsInThisRun.set(key, (playsInThisRun.get(key) ?? 0) + 1);
    }
    for (const entry of episodeHistory) {
      const seriesImdbId = entry.show?.ids?.imdb;
      const season = entry.episode?.season;
      const episode = entry.episode?.number;
      if (!seriesImdbId || !entry.watched_at || season === undefined || episode === undefined) continue;
      const key = `episode:${seriesImdbId}:${season}:${episode}`;
      playsInThisRun.set(key, (playsInThisRun.get(key) ?? 0) + 1);
    }
  }

  // Reconciles a history entry against the event already stored for it.
  //
  // Beyond stamping the Trakt id on a legacy row, a backfill has to undo the
  // aggregate play counts the watched-list import writes (one row carrying
  // every play of an item), since it is bringing those same plays in as
  // individual events and counting both would double them.
  //
  // Only when this run actually carries them all, though. `plays` also climbs
  // from local scrobbles, which reach Trakt best-effort and may never have
  // arrived — and a backfill can be cut short by its page cap. Dropping a row
  // to a single play on the strength of one matching history entry would throw
  // away every play the import cannot account for, so the count has to cover
  // the row before it is replaced.
  const reconcileExistingEvent = async (
    existingEvent: { id: string; traktHistoryId: bigint | null; plays: number },
    historyId: bigint | null,
    playsKey: string
  ) => {
    const data: { traktHistoryId?: bigint; plays?: number } = {};
    if (historyId && existingEvent.traktHistoryId == null) data.traktHistoryId = historyId;
    if (
      isBackfill &&
      existingEvent.traktHistoryId == null &&
      existingEvent.plays > 1 &&
      (playsInThisRun.get(playsKey) ?? 0) >= existingEvent.plays
    ) {
      data.plays = 1;
    }
    if (Object.keys(data).length === 0) return;
    await prisma.watchEvent.update({ where: { id: existingEvent.id }, data });
  };

  // The create the two loops below reach when the lookup found nothing, guarded
  // against another writer having filled that gap in between.
  //
  // Which uniqueness rejects it depends on the entry. One carrying a Trakt id is
  // keyed by `traktHistoryId` and sits outside `watchevent_dedup_key`, which is
  // partial on that column being null — so one history entry stays one row and a
  // same-day rewatch imports as the two plays it was. One without an id falls
  // under the dedup key like every other writer's rows do, and the row that beat
  // it there may carry any timestamp within the same UTC day.
  //
  // Either way the watch is now stored, which is what the import wanted. Re-read
  // and reconcile, so an overlapping "Sync now" costs nothing rather than a 500
  // that abandons the rest of the poll.
  const createOrReconcileEvent = async (
    data: Prisma.WatchEventUncheckedCreateInput,
    historyId: bigint | null,
    dedupKey: WatchEventDedupKey,
    playsKey: string
  ) => {
    try {
      await prisma.watchEvent.create({ data });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      const winner = historyId
        ? await prisma.watchEvent.findUnique({ where: { traktHistoryId: historyId } })
        : await prisma.watchEvent.findFirst({ where: watchEventDedupWhere(dedupKey) });
      if (winner) await reconcileExistingEvent(winner, historyId, playsKey);
    }
  };

  for (const entry of movieHistory) {
    const imdbId = entry.movie?.ids?.imdb;
    const watchedAt = entry.watched_at;
    if (!imdbId || !watchedAt) continue;

    const watchedAtDate = new Date(watchedAt);
    const historyId = entry.id != null ? BigInt(entry.id) : null;
    const title = entry.movie?.title?.trim();
    if (title && !upsertedTitles.has(`movie:${imdbId}`)) {
      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.movie, imdbId } },
        create: { type: ItemType.movie, imdbId, title },
        update: { title },
      });
      upsertedTitles.add(`movie:${imdbId}`);
    }

    // Each Trakt history entry represents exactly one play. Re-polling an
    // already-imported entry (e.g. overlapping windows) must be a no-op,
    // not increment plays again. Also fall back to matching a legacy row
    // (imported before traktHistoryId tracking existed, so its
    // traktHistoryId is still null) so it gets backfilled instead of
    // duplicated.
    const existingEvent =
      (historyId ? await prisma.watchEvent.findUnique({ where: { traktHistoryId: historyId } }) : null) ??
      (await prisma.watchEvent.findFirst({ where: { profileId, type: "movie", imdbId, watchedAt: watchedAtDate } }));

    if (existingEvent) {
      await reconcileExistingEvent(existingEvent, historyId, `movie:${imdbId}`);
    } else {
      await createOrReconcileEvent(
        { type: "movie", imdbId, watchedAt: watchedAtDate, plays: 1, traktHistoryId: historyId, profileId },
        historyId,
        { profileId, type: "movie", imdbId, watchedAt: watchedAtDate },
        `movie:${imdbId}`
      );
    }

    importedWatchEvents.movies += 1;
  }

  for (const entry of episodeHistory) {
    const seriesImdbId = entry.show?.ids?.imdb;
    const watchedAt = entry.watched_at;
    const season = entry.episode?.season;
    const episode = entry.episode?.number;

    if (!seriesImdbId || !watchedAt || season === undefined || episode === undefined) continue;

    const watchedAtDate = new Date(watchedAt);
    const historyId = entry.id != null ? BigInt(entry.id) : null;
    const seriesTitle = entry.show?.title?.trim();
    if (seriesTitle && !upsertedTitles.has(`series:${seriesImdbId}`)) {
      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.series, imdbId: seriesImdbId } },
        create: { type: ItemType.series, imdbId: seriesImdbId, title: seriesTitle },
        update: { title: seriesTitle },
      });
      upsertedTitles.add(`series:${seriesImdbId}`);
    }

    // imdbId mirrors seriesImdbId for episode events, matching the convention
    // used by recordWatchEvent() for scrobbles from other sources (Plex,
    // Jellyfin, generic scrobble), so the same watch can't be double-counted
    // across import paths. Also fall back to matching a legacy row (imported
    // before traktHistoryId tracking existed) so it gets backfilled instead
    // of duplicated.
    const existingEvent =
      (historyId ? await prisma.watchEvent.findUnique({ where: { traktHistoryId: historyId } }) : null) ??
      (await prisma.watchEvent.findFirst({
        where: { profileId, type: "episode", seriesImdbId, season, episode, watchedAt: watchedAtDate },
      }));

    if (existingEvent) {
      await reconcileExistingEvent(existingEvent, historyId, `episode:${seriesImdbId}:${season}:${episode}`);
    } else {
      await createOrReconcileEvent(
        {
          type: "episode",
          imdbId: seriesImdbId,
          seriesImdbId,
          season,
          episode,
          watchedAt: watchedAtDate,
          plays: 1,
          traktHistoryId: historyId,
          profileId,
        },
        historyId,
        { profileId, type: "episode", imdbId: seriesImdbId, season, episode, watchedAt: watchedAtDate },
        `episode:${seriesImdbId}:${season}:${episode}`
      );
    }

    const existing = seriesProgressByImdb.get(seriesImdbId);
    if (
      !existing ||
      watchedAtDate.getTime() > existing.lastWatchedAt.getTime() ||
      (watchedAtDate.getTime() === existing.lastWatchedAt.getTime() &&
        (season > existing.lastSeason ||
          (season === existing.lastSeason && episode > existing.lastEpisode)))
    ) {
      seriesProgressByImdb.set(seriesImdbId, {
        lastSeason: season,
        lastEpisode: episode,
        lastWatchedAt: watchedAtDate,
      });
    }

    importedWatchEvents.episodes += 1;
  }

  for (const [seriesImdbId, progress] of seriesProgressByImdb.entries()) {
    await upsertSeriesProgressIfNewer(profileId, seriesImdbId, progress);
  }

  // Written only after every event above landed, so a run that throws part-way
  // is retried from the same point rather than skipped over — and written
  // together, so a backfill can never record its watermark while failing to
  // record that it was a backfill, which would leave the account looking
  // fully imported when it isn't.
  await prisma.$transaction([
    prisma.kV.upsert({
      where: { key: TRAKT_LAST_POLLED_AT_KEY },
      create: {
        key: TRAKT_LAST_POLLED_AT_KEY,
        value: pollCompletedAt.toISOString(),
        updatedAt: pollCompletedAt,
      },
      update: {
        value: pollCompletedAt.toISOString(),
        updatedAt: pollCompletedAt,
      },
    }),
    ...(isBackfill
      ? [
          prisma.kV.upsert({
            where: { key: TRAKT_HISTORY_BACKFILLED_AT_KEY },
            create: {
              key: TRAKT_HISTORY_BACKFILLED_AT_KEY,
              value: pollCompletedAt.toISOString(),
              updatedAt: pollCompletedAt,
            },
            update: {
              value: pollCompletedAt.toISOString(),
              updatedAt: pollCompletedAt,
            },
          }),
        ]
      : []),
  ]);

  return {
    since: pollStartAtIso ?? null,
    fullBackfill: isBackfill,
    polledAt: pollCompletedAt.toISOString(),
    importedWatchEvents,
    updatedSeriesProgress: seriesProgressByImdb.size,
  };
};
