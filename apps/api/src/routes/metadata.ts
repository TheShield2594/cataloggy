import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getTmdb } from "../lib/tmdb-client.js";
import { upsertMetadata, fetchMetadata, syncMetadata } from "../lib/metadata.js";
import { getOmdbApiKey, fetchOmdbRatings, upsertOmdbRatings } from "../lib/omdb.js";
import { getRpdbApiKey, withRpdbPoster } from "../lib/rpdb.js";
import { getMetadataType } from "../lib/types.js";
import { castCache, seasonsCache, watchProvidersCache } from "../lib/cache.js";
import { getRegionSetting } from "../lib/settings.js";
import { searchAnime } from "../lib/anilist-client.js";

const metadataRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { type: string; imdbId: string } }>(
    "/meta/:type/:imdbId",
    async (request, reply) => {
      const type = getMetadataType(request.params.type);
      if (!type) {
        return reply.code(400).send({ error: "type must be one of: movie, series" });
      }

      const imdbId = request.params.imdbId.trim();
      if (!imdbId) {
        return reply.code(400).send({ error: "imdbId is required" });
      }

      const [existing, rpdbKey] = await Promise.all([
        prisma.metadata.findUnique({ where: { imdbId_type: { imdbId, type } } }),
        getRpdbApiKey(),
      ]);

      const isDetailComplete = (row: typeof existing) =>
        row != null &&
        row.runtime != null &&
        row.certification != null &&
        row.status != null &&
        row.network != null &&
        row.releaseDate != null &&
        (row.imdbRating != null || row.rtScore != null || row.mcScore != null);

      if (isDetailComplete(existing)) {
        return { ...existing, poster: withRpdbPoster(imdbId, existing!.poster, rpdbKey) };
      }

      try {
        const metadata = await fetchMetadata(type, imdbId);
        if (!metadata) {
          return reply.code(404).send({ error: "Metadata not found" });
        }
        const fresh = await prisma.metadata.findUnique({ where: { imdbId_type: { imdbId, type } } });
        return fresh
          ? { ...fresh, poster: withRpdbPoster(imdbId, fresh.poster, rpdbKey) }
          : { ...metadata, poster: withRpdbPoster(imdbId, metadata.poster, rpdbKey) };
      } catch (error) {
        request.log.error(error, "Metadata fetch failed");
        return reply.code(500).send({ error: "Metadata fetch failed" });
      }
    }
  );

  app.get<{ Params: { type: string; imdbId: string } }>(
    "/meta/:type/:imdbId/cast",
    async (request, reply) => {
      const type = getMetadataType(request.params.type);
      if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });

      const imdbId = request.params.imdbId.trim();
      const cacheKey = `cast:${type}:${imdbId}`;
      const cached = castCache.get(cacheKey);
      if (cached) return { cast: cached };

      let meta = await prisma.metadata.findUnique({
        where: { imdbId_type: { imdbId, type } },
        select: { tmdbId: true },
      });

      if (!meta?.tmdbId) {
        await fetchMetadata(type, imdbId).catch((err) =>
          request.log.warn({ imdbId, type, err }, "Background metadata fetch failed")
        );
        meta = await prisma.metadata.findUnique({
          where: { imdbId_type: { imdbId, type } },
          select: { tmdbId: true },
        });
      }

      if (!meta?.tmdbId) return { cast: [] };

      try {
        const tmdb = await getTmdb();
        const cast = await tmdb.getCast(type, meta.tmdbId);
        castCache.set(cacheKey, cast);
        return { cast };
      } catch {
        return { cast: [] };
      }
    }
  );

  app.get<{ Params: { imdbId: string } }>(
    "/meta/series/:imdbId/seasons",
    async (request) => {
      const imdbId = request.params.imdbId.trim();
      const cacheKey = `seasons:${imdbId}`;
      const cached = seasonsCache.get(cacheKey);
      if (cached) return { seasons: cached };

      let meta = await prisma.metadata.findUnique({
        where: { imdbId_type: { imdbId, type: "series" } },
        select: { tmdbId: true },
      });

      if (!meta?.tmdbId) {
        await fetchMetadata("series", imdbId).catch((err) =>
          request.log.warn({ imdbId, err }, "Background metadata fetch failed")
        );
        meta = await prisma.metadata.findUnique({
          where: { imdbId_type: { imdbId, type: "series" } },
          select: { tmdbId: true },
        });
      }

      if (!meta?.tmdbId) return { seasons: [] };

      try {
        const tmdb = await getTmdb();
        const seasons = await tmdb.getSeasons(meta.tmdbId);
        seasonsCache.set(cacheKey, seasons);
        return { seasons };
      } catch {
        return { seasons: [] };
      }
    }
  );

  app.get<{ Params: { type: string; imdbId: string } }>(
    "/meta/:type/:imdbId/providers",
    async (request) => {
      const type = getMetadataType(request.params.type);
      if (!type) return { providers: { link: null, flatrate: [], free: [], ads: [] } };

      const imdbId = request.params.imdbId.trim();
      const region = await getRegionSetting();
      const cacheKey = `providers:${type}:${imdbId}:${region}`;
      const cached = watchProvidersCache.get(cacheKey);
      if (cached) return { providers: cached };

      let meta = await prisma.metadata.findUnique({
        where: { imdbId_type: { imdbId, type } },
        select: { tmdbId: true },
      });

      if (!meta?.tmdbId) {
        await fetchMetadata(type, imdbId).catch((err) =>
          request.log.warn({ imdbId, type, err }, "Background metadata fetch failed")
        );
        meta = await prisma.metadata.findUnique({
          where: { imdbId_type: { imdbId, type } },
          select: { tmdbId: true },
        });
      }

      if (!meta?.tmdbId) return { providers: { link: null, flatrate: [], free: [], ads: [] } };

      try {
        const tmdb = await getTmdb();
        const providers = await tmdb.getWatchProviders(type, meta.tmdbId, region);
        watchProvidersCache.set(cacheKey, providers);
        return { providers };
      } catch {
        return { providers: { link: null, flatrate: [], free: [], ads: [] } };
      }
    }
  );

  app.post<{ Body: unknown }>("/metadata/sync", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    const imdbId = typeof body?.imdbId === "string" ? body.imdbId.trim() : "";
    if (!imdbId) {
      return reply.code(400).send({ error: "imdbId is required" });
    }

    const type = getMetadataType((body?.type as string | undefined) ?? "");
    if (!type) {
      return reply.code(400).send({ error: "type must be one of: movie, series" });
    }

    try {
      const metadata = await syncMetadata(imdbId, type);
      if (!metadata) {
        return reply.code(404).send({ error: "Metadata not found on TMDB" });
      }
      return metadata;
    } catch (error) {
      request.log.error(error, "Metadata sync failed");
      return reply.code(500).send({ error: "Metadata sync failed" });
    }
  });

  app.post<{ Querystring: { limit?: string } }>("/metadata/refresh-all", async (request, reply) => {
    const rawLimit = parseInt(request.query.limit ?? "50", 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 500);
    const allMetadata = await prisma.metadata.findMany({
      select: { imdbId: true, type: true },
      take: limit,
    });

    if (allMetadata.length === 0) {
      return reply.send({ refreshed: 0, total: 0, limit });
    }

    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 500;
    let tmdb: Awaited<ReturnType<typeof getTmdb>>;
    try {
      tmdb = await getTmdb();
    } catch (error) {
      request.log.error(error, "TMDB initialization failed for metadata refresh");
      return reply.code(500).send({ error: "TMDB initialization failed" });
    }

    const omdbKey = await getOmdbApiKey();
    let refreshed = 0;

    for (let i = 0; i < allMetadata.length; i += BATCH_SIZE) {
      const batch = allMetadata.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          const payload = await tmdb.findByImdbId(item.type, item.imdbId);
          if (payload) {
            await upsertMetadata(payload);
            if (omdbKey) {
              try {
                const omdb = await fetchOmdbRatings(item.imdbId, omdbKey);
                if (omdb) await upsertOmdbRatings(item.imdbId, item.type, omdb);
              } catch { /* best-effort */ }
            }
            return true;
          }
          return false;
        })
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === "fulfilled" && result.value) {
          refreshed++;
        } else if (result.status === "rejected") {
          const item = batch[j];
          request.log.warn(
            { imdbId: item.imdbId, type: item.type, error: result.reason },
            "Failed to refresh metadata"
          );
        }
      }

      if (i + BATCH_SIZE < allMetadata.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    return reply.send({ refreshed, total: allMetadata.length, limit });
  });

  app.get<{ Querystring: { q?: string } }>("/metadata/anime-search", async (request, reply) => {
    const q = request.query.q?.trim();
    if (!q) {
      return reply.code(400).send({ error: "q is required" });
    }

    try {
      const results = await searchAnime(q);
      return { results };
    } catch (error) {
      request.log.error(error, "AniList search failed");
      return reply.code(502).send({ error: "AniList search failed" });
    }
  });

  app.get("/genres", async () => {
    const rows = await prisma.metadata.findMany({
      where: { genres: { isEmpty: false } },
      select: { genres: true },
    });
    const genreSet = new Set<string>();
    for (const row of rows) {
      for (const g of row.genres) genreSet.add(g);
    }
    const genres = [...genreSet].sort();
    return { genres };
  });
};

export default metadataRoutes;
