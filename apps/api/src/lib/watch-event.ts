import { prisma } from "./prisma.js";
import { upsertSeriesProgressIfNewer } from "./series-progress.js";
import { shouldRefreshAiRecs, getAiRecommendations } from "./ai.js";
import { trendingCache } from "./cache.js";
import type { RecordWatchParams } from "./types.js";

export const recordWatchEvent = async (params: RecordWatchParams) => {
  const { type, imdbId, seriesImdbId, season, episode, watchedAt, source, request: req } = params;

  const dayStart = new Date(watchedAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(watchedAt);
  dayEnd.setUTCHours(23, 59, 59, 999);

  if (type === "episode") {
    const resolvedSeriesImdbId = seriesImdbId ?? imdbId;

    const watchEvent = await prisma.$transaction(async (tx) => {
      const existing = await tx.watchEvent.findFirst({
        where: {
          seriesImdbId: resolvedSeriesImdbId,
          season: season ?? null,
          episode: episode ?? null,
          watchedAt: { gte: dayStart, lte: dayEnd },
        },
      });

      if (existing) {
        const updated = await tx.watchEvent.update({
          where: { id: existing.id },
          data: { plays: existing.plays + 1, watchedAt },
        });
        req.log.info(
          { imdbId: resolvedSeriesImdbId, season, episode, plays: updated.plays },
          `${source} scrobble: episode play incremented`
        );
        return updated;
      }

      const created = await tx.watchEvent.create({
        data: {
          type: "episode",
          imdbId: resolvedSeriesImdbId,
          seriesImdbId: resolvedSeriesImdbId,
          season: season ?? null,
          episode: episode ?? null,
          watchedAt,
        },
      });
      req.log.info({ imdbId: resolvedSeriesImdbId, season, episode }, `${source} scrobble: episode recorded`);
      return created;
    });

    if (season != null && episode != null) {
      await upsertSeriesProgressIfNewer(resolvedSeriesImdbId, {
        lastSeason: season,
        lastEpisode: episode,
        lastWatchedAt: watchedAt,
      });
    }

    void (async () => {
      try {
        if (await shouldRefreshAiRecs()) {
          trendingCache.delete("ai-recs:movie");
          trendingCache.delete("ai-recs:series");
          await Promise.allSettled([
            getAiRecommendations("movie", 15),
            getAiRecommendations("series", 15),
          ]);
        }
      } catch { /* never let this affect the watch event response */ }
    })();

    return { status: "recorded" as const, watchEvent };
  }

  const watchEvent = await prisma.$transaction(async (tx) => {
    const existing = await tx.watchEvent.findFirst({
      where: { imdbId, type: "movie", watchedAt: { gte: dayStart, lte: dayEnd } },
    });

    if (existing) {
      const updated = await tx.watchEvent.update({
        where: { id: existing.id },
        data: { plays: existing.plays + 1, watchedAt },
      });
      req.log.info({ imdbId, plays: updated.plays }, `${source} scrobble: movie play incremented`);
      return updated;
    }

    const created = await tx.watchEvent.create({
      data: { type: "movie", imdbId, watchedAt },
    });
    req.log.info({ imdbId }, `${source} scrobble: movie recorded`);
    return created;
  });

  void (async () => {
    try {
      if (await shouldRefreshAiRecs()) {
        trendingCache.delete("ai-recs:movie");
        trendingCache.delete("ai-recs:series");
        await Promise.allSettled([
          getAiRecommendations("movie", 15),
          getAiRecommendations("series", 15),
        ]);
      }
    } catch { /* never let this affect the watch event response */ }
  })();

  return { status: "recorded" as const, watchEvent };
};
