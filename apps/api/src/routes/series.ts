import { MetadataType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getTmdb } from "../lib/tmdb-client.js";
import { upsertMetadata } from "../lib/metadata.js";
import { upsertSeriesProgressIfNewer } from "../lib/series-progress.js";
import { resolveProfile } from "../lib/profile.js";
import { computeNextEpisode } from "../lib/next-episode.js";

const DROPPED_KEY = (profileId: string, imdbId: string) => `dropped:series:${profileId}:${imdbId}`;

const seriesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  app.get<{ Params: { imdbId: string } }>("/show/:imdbId/dropped", async (request) => {
    const row = await prisma.kV.findUnique({ where: { key: DROPPED_KEY(request.profileId!, request.params.imdbId) } });
    return { dropped: !!row };
  });

  app.post<{ Params: { imdbId: string } }>("/show/:imdbId/drop", async (request) => {
    const key = DROPPED_KEY(request.profileId!, request.params.imdbId);
    await prisma.kV.upsert({
      where: { key },
      create: { key, value: "true", updatedAt: new Date() },
      update: { value: "true", updatedAt: new Date() },
    });
    return { dropped: true };
  });

  app.delete<{ Params: { imdbId: string } }>("/show/:imdbId/drop", async (request) => {
    await prisma.kV.deleteMany({ where: { key: DROPPED_KEY(request.profileId!, request.params.imdbId) } });
    return { dropped: false };
  });

  app.get("/series/progress", async (request) => {
    const profileId = request.profileId!;
    const progressRows = await prisma.seriesProgress.findMany({
      where: { profileId },
      orderBy: { lastWatchedAt: "desc" },
    });

    if (progressRows.length === 0) return { progress: [] };

    const imdbIds = progressRows.map((p) => p.seriesImdbId);
    const [metadata, episodeCounts] = await Promise.all([
      prisma.metadata.findMany({
        where: { imdbId: { in: imdbIds }, type: "series" },
        select: { imdbId: true, name: true, poster: true, totalSeasons: true, totalEpisodes: true, tmdbId: true },
      }),
      prisma.watchEvent.groupBy({
        by: ["seriesImdbId", "season", "episode"],
        where: { profileId, seriesImdbId: { in: imdbIds }, type: "episode" },
        _count: { _all: true },
      }),
    ]);

    const metaByImdbId = new Map(metadata.map((m) => [m.imdbId, m]));
    const watchedBySeriesId = new Map<string, number>();
    for (const row of episodeCounts) {
      watchedBySeriesId.set(
        row.seriesImdbId!,
        (watchedBySeriesId.get(row.seriesImdbId!) ?? 0) + 1
      );
    }

    const SYNC_INLINE_LIMIT = 10;
    const missingMetaIds = imdbIds.filter((id) => !metaByImdbId.has(id));
    if (missingMetaIds.length > 0) {
      const inlineBatch = missingMetaIds.slice(0, SYNC_INLINE_LIMIT);
      const backgroundBatch = missingMetaIds.slice(SYNC_INLINE_LIMIT);

      try {
        const tmdb = await getTmdb();
        const freshMeta = await Promise.allSettled(
          inlineBatch.map(async (id) => {
            const payload = await tmdb.findByImdbId(MetadataType.series, id);
            if (payload) {
              await upsertMetadata(payload);
              return payload;
            }
            return null;
          })
        );

        for (const result of freshMeta) {
          if (result.status === "fulfilled" && result.value) {
            metaByImdbId.set(result.value.imdbId, {
              imdbId: result.value.imdbId,
              name: result.value.name,
              poster: result.value.poster,
              totalSeasons: result.value.totalSeasons,
              totalEpisodes: result.value.totalEpisodes,
              tmdbId: result.value.tmdbId,
            });
          }
        }

        if (backgroundBatch.length > 0) {
          void (async () => {
            for (const id of backgroundBatch) {
              try {
                const payload = await tmdb.findByImdbId(MetadataType.series, id);
                if (payload) await upsertMetadata(payload);
              } catch { /* skip */ }
            }
          })();
        }
      } catch { /* TMDB unavailable – return what we have */ }
    }

    const progress = await Promise.all(
      progressRows.map(async (row) => {
        const meta = metaByImdbId.get(row.seriesImdbId);
        const next = await computeNextEpisode(
          row.seriesImdbId,
          meta?.tmdbId ?? null,
          row.lastSeason,
          row.lastEpisode
        );
        return {
          imdbId: row.seriesImdbId,
          seriesImdbId: row.seriesImdbId,
          lastSeason: row.lastSeason,
          lastEpisode: row.lastEpisode,
          nextSeason: next?.season ?? null,
          nextEpisode: next?.episode ?? null,
          lastWatchedAt: row.lastWatchedAt,
          updatedAt: row.updatedAt,
          name: meta?.name ?? row.seriesImdbId,
          poster: meta?.poster ?? null,
          totalSeasons: meta?.totalSeasons ?? null,
          totalEpisodes: meta?.totalEpisodes ?? null,
          watchedEpisodes: watchedBySeriesId.get(row.seriesImdbId) ?? null,
        };
      })
    );

    return { progress };
  });

  app.get<{ Params: { imdbId: string } }>("/series/progress/:imdbId", async (request, reply) => {
    const { imdbId } = request.params;
    const profileId = request.profileId!;

    const row = await prisma.seriesProgress.findUnique({
      where: { profileId_seriesImdbId: { profileId, seriesImdbId: imdbId } },
    });
    if (!row) return reply.code(404).send({ error: "No progress found for this series" });

    const [meta, uniqueEpisodes] = await Promise.all([
      prisma.metadata.findUnique({
        where: { imdbId_type: { imdbId, type: "series" } },
        select: { name: true, poster: true, totalSeasons: true, totalEpisodes: true },
      }),
      prisma.watchEvent.groupBy({
        by: ["season", "episode"],
        where: { profileId, seriesImdbId: imdbId, type: "episode" },
      }),
    ]);

    return {
      progress: {
        seriesImdbId: row.seriesImdbId,
        lastSeason: row.lastSeason,
        lastEpisode: row.lastEpisode,
        lastWatchedAt: row.lastWatchedAt,
        updatedAt: row.updatedAt,
        name: meta?.name ?? null,
        poster: meta?.poster ?? null,
        totalSeasons: meta?.totalSeasons ?? null,
        totalEpisodes: meta?.totalEpisodes ?? null,
        watchedEpisodes: uniqueEpisodes.length,
      },
    };
  });

  app.post<{ Params: { imdbId: string } }>(
    "/series/:imdbId/watch-next",
    async (request, reply) => {
      const { imdbId } = request.params;
      const profileId = request.profileId!;

      const row = await prisma.seriesProgress.findUnique({
        where: { profileId_seriesImdbId: { profileId, seriesImdbId: imdbId } },
      });
      if (!row) return reply.code(404).send({ error: "No progress found for this series" });

      const meta = await prisma.metadata.findUnique({
        where: { imdbId_type: { imdbId, type: "series" } },
        select: { tmdbId: true },
      });

      const next = await computeNextEpisode(imdbId, meta?.tmdbId ?? null, row.lastSeason, row.lastEpisode);
      if (!next) return reply.code(409).send({ error: "Series already fully watched" });

      const nextSeason = next.season;
      const nextEpisode = next.episode;
      const watchedAt = new Date();

      await prisma.watchEvent.create({
        data: {
          type: "episode",
          imdbId,
          seriesImdbId: imdbId,
          season: nextSeason,
          episode: nextEpisode,
          watchedAt,
          plays: 1,
          profileId,
        },
      });

      await upsertSeriesProgressIfNewer(profileId, imdbId, {
        lastSeason: nextSeason,
        lastEpisode: nextEpisode,
        lastWatchedAt: watchedAt,
      });

      return reply.code(204).send();
    }
  );
};

export default seriesRoutes;
