import { MetadataType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getTmdb } from "../lib/tmdb-client.js";
import { upsertMetadata } from "../lib/metadata.js";
import { upsertSeriesProgressIfNewer } from "../lib/series-progress.js";
import { resolveProfile } from "../lib/profile.js";
import { computeNextEpisode } from "../lib/next-episode.js";
import { droppedSeriesKey, getDroppedSeriesIds } from "../lib/dropped-shows.js";
import { recordWatchEvent } from "../lib/watch-event.js";

const DROPPED_KEY = droppedSeriesKey;

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
    const allProgressRows = await prisma.seriesProgress.findMany({
      where: { profileId },
      orderBy: { lastWatchedAt: "desc" },
    });

    if (allProgressRows.length === 0) return { progress: [] };

    const droppedIds = await getDroppedSeriesIds(
      profileId,
      allProgressRows.map((p) => p.seriesImdbId)
    );
    const progressRows = allProgressRows.filter((p) => !droppedIds.has(p.seriesImdbId));

    if (progressRows.length === 0) return { progress: [] };

    const imdbIds = progressRows.map((p) => p.seriesImdbId);
    const [metadata, episodeCounts] = await Promise.all([
      prisma.metadata.findMany({
        where: { imdbId: { in: imdbIds }, type: "series" },
        select: { imdbId: true, name: true, poster: true, background: true, totalSeasons: true, totalEpisodes: true, tmdbId: true },
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
              background: result.value.background,
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

    const progressWithNulls = await Promise.all(
      progressRows.map(async (row) => {
        const meta = metaByImdbId.get(row.seriesImdbId);
        const next = await computeNextEpisode(
          row.seriesImdbId,
          meta?.tmdbId ?? null,
          row.lastSeason,
          row.lastEpisode
        );
        // Series is fully watched (no further season exists) — drop from Continue Watching.
        if (!next) return null;
        return {
          imdbId: row.seriesImdbId,
          seriesImdbId: row.seriesImdbId,
          lastSeason: row.lastSeason,
          lastEpisode: row.lastEpisode,
          nextSeason: next.season,
          nextEpisode: next.episode,
          lastWatchedAt: row.lastWatchedAt,
          updatedAt: row.updatedAt,
          name: meta?.name ?? row.seriesImdbId,
          poster: meta?.poster ?? null,
          background: meta?.background ?? null,
          totalSeasons: meta?.totalSeasons ?? null,
          totalEpisodes: meta?.totalEpisodes ?? null,
          watchedEpisodes: watchedBySeriesId.get(row.seriesImdbId) ?? null,
        };
      })
    );

    const progress = progressWithNulls.filter((p): p is NonNullable<typeof p> => p !== null);

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

  app.get<{ Params: { imdbId: string } }>("/series/:imdbId/watched-episodes", async (request) => {
    const { imdbId } = request.params;
    const profileId = request.profileId!;

    const events = await prisma.watchEvent.findMany({
      where: { profileId, type: "episode", seriesImdbId: imdbId, season: { not: null }, episode: { not: null } },
      select: { season: true, episode: true },
      distinct: ["season", "episode"],
    });

    return { episodes: events.map((e) => ({ season: e.season!, episode: e.episode! })) };
  });

  app.post<{ Params: { imdbId: string; seasonNumber: string; episodeNumber: string } }>(
    "/series/:imdbId/season/:seasonNumber/episode/:episodeNumber/watch",
    async (request, reply) => {
      const { imdbId } = request.params;
      const seasonNumber = Number(request.params.seasonNumber);
      const episodeNumber = Number(request.params.episodeNumber);
      if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
        return reply.code(400).send({ error: "season and episode must be positive integers" });
      }

      await recordWatchEvent({
        type: "episode",
        imdbId,
        seriesImdbId: imdbId,
        season: seasonNumber,
        episode: episodeNumber,
        watchedAt: new Date(),
        source: "manual",
        request,
      });

      return reply.code(204).send();
    }
  );

  app.delete<{ Params: { imdbId: string; seasonNumber: string; episodeNumber: string } }>(
    "/series/:imdbId/season/:seasonNumber/episode/:episodeNumber/watch",
    async (request, reply) => {
      const { imdbId } = request.params;
      const seasonNumber = Number(request.params.seasonNumber);
      const episodeNumber = Number(request.params.episodeNumber);
      if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
        return reply.code(400).send({ error: "season and episode must be positive integers" });
      }

      const profileId = request.profileId!;

      await prisma.$transaction(async (tx) => {
        await tx.watchEvent.deleteMany({
          where: { profileId, type: "episode", seriesImdbId: imdbId, season: seasonNumber, episode: episodeNumber },
        });

        const latest = await tx.watchEvent.findFirst({
          where: {
            profileId,
            seriesImdbId: imdbId,
            type: "episode",
            season: { not: null },
            episode: { not: null },
          },
          orderBy: { watchedAt: "desc" },
        });

        if (latest && latest.season != null && latest.episode != null) {
          await tx.seriesProgress.upsert({
            where: { profileId_seriesImdbId: { profileId, seriesImdbId: imdbId } },
            update: {
              lastSeason: latest.season,
              lastEpisode: latest.episode,
              lastWatchedAt: latest.watchedAt,
              updatedAt: new Date(),
            },
            create: {
              profileId,
              seriesImdbId: imdbId,
              lastSeason: latest.season,
              lastEpisode: latest.episode,
              lastWatchedAt: latest.watchedAt,
              updatedAt: new Date(),
            },
          });
        } else {
          await tx.seriesProgress.deleteMany({ where: { profileId, seriesImdbId: imdbId } });
        }
      });

      return reply.code(204).send();
    }
  );

  app.post<{ Params: { imdbId: string; seasonNumber: string }; Body: unknown }>(
    "/series/:imdbId/season/:seasonNumber/watch-all",
    async (request, reply) => {
      const { imdbId } = request.params;
      const seasonNumber = Number(request.params.seasonNumber);
      if (!Number.isInteger(seasonNumber) || seasonNumber < 1) {
        return reply.code(400).send({ error: "seasonNumber must be a positive integer" });
      }

      const body = request.body as { episodeNumbers?: unknown } | null;
      if (
        !Array.isArray(body?.episodeNumbers) ||
        body.episodeNumbers.length === 0 ||
        !body.episodeNumbers.every((n) => Number.isInteger(n) && n > 0)
      ) {
        return reply.code(400).send({ error: "episodeNumbers must be a non-empty array of positive integers" });
      }

      const profileId = request.profileId!;
      const episodeNumbers = [...new Set(body.episodeNumbers as number[])];

      const existing = await prisma.watchEvent.findMany({
        where: {
          profileId,
          type: "episode",
          seriesImdbId: imdbId,
          season: seasonNumber,
          episode: { in: episodeNumbers },
        },
        select: { episode: true },
      });
      const alreadyWatched = new Set(existing.map((e) => e.episode));
      const toMark = episodeNumbers.filter((n) => !alreadyWatched.has(n));

      const watchedAt = new Date();
      await Promise.all(
        toMark.map((episode) =>
          recordWatchEvent({
            type: "episode",
            imdbId,
            seriesImdbId: imdbId,
            season: seasonNumber,
            episode,
            watchedAt,
            source: "manual",
            request,
          })
        )
      );

      // recordWatchEvent's per-call progress upsert can race when these run
      // concurrently (e.g. two "no existing row" creates for a brand new
      // series), so re-assert the true maximum once all writes have landed.
      // Use the full requested set (not just toMark) — episodes that were
      // already watched before this call still count toward "furthest watched".
      if (toMark.length > 0) {
        await upsertSeriesProgressIfNewer(profileId, imdbId, {
          lastSeason: seasonNumber,
          lastEpisode: Math.max(...episodeNumbers),
          lastWatchedAt: watchedAt,
        });
      }

      return { marked: toMark.length, total: episodeNumbers.length };
    }
  );
};

export default seriesRoutes;
