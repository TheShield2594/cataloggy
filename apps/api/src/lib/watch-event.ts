import { prisma } from "./prisma.js";
import { isUniqueConstraintError } from "./prisma-tolerant.js";
import { upsertSeriesProgressIfNewer } from "./series-progress.js";
import { shouldRefreshAiRecs, getAiRecommendations } from "./ai.js";
import { trendingCacheDeletePrefix } from "./cache.js";
import { syncWatchEventToTrakt } from "./trakt-client.js";
import { watchEventDayWindow } from "./watch-event-dedup.js";
import type { RecordWatchParams } from "./types.js";

/**
 * Re-runs a read-then-write once if the dedup key rejected the write.
 *
 * The lookup below can only see rows that were committed when it ran, so two
 * writers recording the same play both used to reach the create and both used to
 * succeed. Now the loser gets P2002, and re-running takes the increment branch
 * against the row the winner wrote — which is what the caller wanted in the first
 * place. Once rather than in a loop: a second P2002 means the conflict is not the
 * one this exists to absorb, and swallowing it would hide a real fault.
 */
const withDedupRetry = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return await run();
  }
};

export const recordWatchEvent = async (params: RecordWatchParams) => {
  const { type, imdbId, seriesImdbId, season, episode, watchedAt, dateUnknown, note, source, profileId, log } = params;

  const { gte: dayStart, lte: dayEnd } = watchEventDayWindow(watchedAt);

  if (type === "episode") {
    const resolvedSeriesImdbId = seriesImdbId ?? imdbId;

    const { watchEvent, wasCreated } = await withDedupRetry(() =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.watchEvent.findFirst({
          where: {
            profileId,
            type: "episode",
            seriesImdbId: resolvedSeriesImdbId,
            season: season ?? null,
            episode: episode ?? null,
            watchedAt: { gte: dayStart, lte: dayEnd },
          },
        });

        if (existing) {
          const updated = await tx.watchEvent.update({
            where: { id: existing.id },
            data: {
              plays: { increment: 1 },
              watchedAt,
              dateUnknown: dateUnknown ?? false,
              ...(note !== undefined ? { note } : {}),
            },
          });
          log.info(
            { imdbId: resolvedSeriesImdbId, season, episode, plays: updated.plays },
            `${source} scrobble: episode play incremented`
          );
          return { watchEvent: updated, wasCreated: false };
        }

        const created = await tx.watchEvent.create({
          data: {
            type: "episode",
            imdbId: resolvedSeriesImdbId,
            seriesImdbId: resolvedSeriesImdbId,
            season: season ?? null,
            episode: episode ?? null,
            watchedAt,
            dateUnknown: dateUnknown ?? false,
            note: note ?? null,
            profileId,
          },
        });
        log.info({ imdbId: resolvedSeriesImdbId, season, episode }, `${source} scrobble: episode recorded`);
        return { watchEvent: created, wasCreated: true };
      })
    );

    if (season != null && episode != null) {
      await upsertSeriesProgressIfNewer(profileId, resolvedSeriesImdbId, {
        lastSeason: season,
        lastEpisode: episode,
        lastWatchedAt: watchedAt,
      });
    }

    syncWatchEventToTrakt(
      watchEvent,
      { type: "episode", imdbId: resolvedSeriesImdbId, seriesImdbId: resolvedSeriesImdbId, season, episode },
      log
    );

    void (async () => {
      try {
        if (await shouldRefreshAiRecs()) {
          trendingCacheDeletePrefix("ai-recs:");
          await Promise.allSettled([
            getAiRecommendations("movie", 15, profileId, log),
            getAiRecommendations("series", 15, profileId, log),
          ]);
        }
      } catch (error) {
        log.warn(error, "Background AI recs refresh failed");
      }
    })();

    return { status: "recorded" as const, watchEvent, wasCreated };
  }

  const { watchEvent, wasCreated } = await withDedupRetry(() =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.watchEvent.findFirst({
        where: { profileId, imdbId, type: "movie", watchedAt: { gte: dayStart, lte: dayEnd } },
      });

      if (existing) {
        const updated = await tx.watchEvent.update({
          where: { id: existing.id },
          data: {
            plays: { increment: 1 },
            watchedAt,
            dateUnknown: dateUnknown ?? false,
            ...(note !== undefined ? { note } : {}),
          },
        });
        log.info({ imdbId, plays: updated.plays }, `${source} scrobble: movie play incremented`);
        return { watchEvent: updated, wasCreated: false };
      }

      const created = await tx.watchEvent.create({
        data: { type: "movie", imdbId, watchedAt, dateUnknown: dateUnknown ?? false, note: note ?? null, profileId },
      });
      log.info({ imdbId }, `${source} scrobble: movie recorded`);
      return { watchEvent: created, wasCreated: true };
    })
  );

  syncWatchEventToTrakt(watchEvent, { type: "movie", imdbId }, log);

  void (async () => {
    try {
      if (await shouldRefreshAiRecs()) {
        trendingCacheDeletePrefix("ai-recs:");
        await Promise.allSettled([
          getAiRecommendations("movie", 15, profileId, log),
          getAiRecommendations("series", 15, profileId, log),
        ]);
      }
    } catch (error) {
      log.warn(error, "Background AI recs refresh failed");
    }
  })();

  return { status: "recorded" as const, watchEvent, wasCreated };
};
