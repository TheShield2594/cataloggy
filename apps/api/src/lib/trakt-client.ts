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
 * Two-way reconciliation between Trakt's watchlist and the local default
 * watchlist. Items present on Trakt but missing locally are added; items
 * that disappeared from Trakt since the last sync (and are still present
 * locally) are removed to mirror the removal. Local items that were never
 * confirmed on Trakt (e.g. a push that failed at add-time) are retried
 * instead of deleted, so a transient failure can't silently drop an item.
 */
export const syncTraktWatchlist = async (
  logger: FastifyRequest["log"],
  profileId: string
): Promise<{ addedLocally: number; removedLocally: number; pushedToTrakt: number }> => {
  if (!(await isTraktConnected())) {
    return { addedLocally: 0, removedLocally: 0, pushedToTrakt: 0 };
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

  let addedLocally = 0;
  let removedLocally = 0;
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

  if (previousSnapshot) {
    for (const [key, item] of localByKey) {
      if (traktKeys.has(key)) continue;

      if (previousSnapshot.has(key)) {
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

  await writeWatchlistSnapshot(traktKeys);

  return { addedLocally, removedLocally, pushedToTrakt };
};

export const TRAKT_LAST_POLLED_AT_KEY = "trakt:lastPolledAt";

const getTraktPollStartAt = async (): Promise<Date> => {
  const kvValue = await prisma.kV.findUnique({ where: { key: TRAKT_LAST_POLLED_AT_KEY } });

  if (!kvValue) return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const parsed = new Date(kvValue.value);
  if (Number.isNaN(parsed.getTime())) return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return parsed;
};

export const pollTraktHistory = async (logger: FastifyRequest["log"], profileId: string) => {
  const client = await getTraktClient();
  const pollStartAt = await getTraktPollStartAt();
  const pollCompletedAt = new Date();
  const pollStartAtIso = pollStartAt.toISOString();

  const [movieHistory, episodeHistory] = await Promise.all([
    client.fetchMovieHistory(logger, pollStartAtIso),
    client.fetchEpisodeHistory(logger, pollStartAtIso),
  ]);

  const importedWatchEvents = { movies: 0, episodes: 0 };
  const seriesProgressByImdb = new Map<string, SeriesProgressCandidate>();

  for (const entry of movieHistory) {
    const imdbId = entry.movie?.ids?.imdb;
    const watchedAt = entry.watched_at;
    if (!imdbId || !watchedAt) continue;

    const watchedAtDate = new Date(watchedAt);
    const historyId = entry.id != null ? BigInt(entry.id) : null;
    const title = entry.movie?.title?.trim();
    if (title) {
      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.movie, imdbId } },
        create: { type: ItemType.movie, imdbId, title },
        update: { title },
      });
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
      if (historyId && existingEvent.traktHistoryId == null) {
        await prisma.watchEvent.update({ where: { id: existingEvent.id }, data: { traktHistoryId: historyId } });
      }
    } else {
      await prisma.watchEvent.create({
        data: { type: "movie", imdbId, watchedAt: watchedAtDate, plays: 1, traktHistoryId: historyId, profileId },
      });
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
    if (seriesTitle) {
      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.series, imdbId: seriesImdbId } },
        create: { type: ItemType.series, imdbId: seriesImdbId, title: seriesTitle },
        update: { title: seriesTitle },
      });
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
      if (historyId && existingEvent.traktHistoryId == null) {
        await prisma.watchEvent.update({ where: { id: existingEvent.id }, data: { traktHistoryId: historyId } });
      }
    } else {
      await prisma.watchEvent.create({
        data: {
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
      });
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

  await prisma.kV.upsert({
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
  });

  return {
    since: pollStartAtIso,
    polledAt: pollCompletedAt.toISOString(),
    importedWatchEvents,
    updatedSeriesProgress: seriesProgressByImdb.size,
  };
};
