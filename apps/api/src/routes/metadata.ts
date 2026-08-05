import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getTmdb } from "../lib/tmdb-client.js";
import { upsertMetadata, syncMetadata } from "../lib/metadata.js";
import { getOmdbApiKey, fetchOmdbRatings, upsertOmdbRatings } from "../lib/omdb.js";
import { getMetadataType } from "../lib/types.js";
import {
  EMPTY_PROVIDERS,
  loadCast,
  loadEpisodes,
  loadMeta,
  loadProviders,
  loadSeasons,
} from "../lib/detail.js";
import { loadRecommendations } from "../lib/recommendations.js";
import { droppedSeriesKey } from "../lib/dropped-shows.js";
import { resolveProfile } from "../lib/profile.js";
import { searchAnime } from "../lib/anilist-client.js";

/** Resolves to `fallback` instead of rejecting, for the bundle's optional sections. */
const settled = <T,>(work: Promise<T>, fallback: T): Promise<T> => work.catch(() => fallback);

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

      try {
        const meta = await loadMeta(type, imdbId);
        if (!meta) return reply.code(404).send({ error: "Metadata not found" });
        return meta;
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

      return loadCast(type, request.params.imdbId.trim(), request.log);
    }
  );

  app.get<{ Params: { imdbId: string } }>(
    "/meta/series/:imdbId/seasons",
    async (request) => {
      return { seasons: await loadSeasons(request.params.imdbId.trim(), request.log) };
    }
  );

  app.get<{ Params: { imdbId: string; seasonNumber: string } }>(
    "/meta/series/:imdbId/season/:seasonNumber/episodes",
    async (request, reply) => {
      const imdbId = request.params.imdbId.trim();
      const seasonNumber = Number(request.params.seasonNumber);
      if (!Number.isInteger(seasonNumber) || seasonNumber < 1) {
        return reply.code(400).send({ error: "seasonNumber must be a positive integer" });
      }

      return { episodes: await loadEpisodes(imdbId, seasonNumber, request.log) };
    }
  );

  app.get<{ Params: { type: string; imdbId: string } }>(
    "/meta/:type/:imdbId/providers",
    async (request) => {
      const type = getMetadataType(request.params.type);
      if (!type) return { providers: EMPTY_PROVIDERS };
      return { providers: await loadProviders(type, request.params.imdbId.trim(), request.log) };
    }
  );

  // Everything the detail panel needs, in one round trip.
  //
  // Opening a title used to cost six parallel requests — meta, cast, providers,
  // recommendations, and for a series seasons and dropped-state — each paying
  // its own HTTP overhead and each independently resolving the same TMDB ID.
  // Parallel is not free on a phone: they queue behind the connection limit, and
  // the panel could only fill in as the slowest of six arrived. Server-side the
  // work is unchanged and still concurrent, but it is now one request, one ID
  // resolution and one response the client can render in a single pass.
  //
  // The per-section routes stay: the season-episode list is still fetched on
  // demand when a season is expanded, and a bundle is the wrong shape for that.
  app.get<{ Params: { type: string; imdbId: string } }>(
    "/meta/:type/:imdbId/bundle",
    // Needed for the dropped flag, which is per-profile. The rest of this
    // plugin is profile-agnostic, so the hook is scoped to this one route.
    { preHandler: resolveProfile },
    async (request, reply) => {
      const type = getMetadataType(request.params.type);
      if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });

      const imdbId = request.params.imdbId.trim();
      if (!imdbId) return reply.code(400).send({ error: "imdbId is required" });

      const isSeries = type === "series";
      const profileId = request.profileId!;

      // `meta` is the panel — without it there is nothing to render, so its
      // rejection is allowed to surface as a 500. The other five are sections
      // within it, and each already degrades to an empty result of its own
      // accord; `allSettled` covers the paths that get past those guards (a
      // database blip inside the dropped lookup, an upstream throwing before its
      // own try block) so one failing row cannot take the whole panel with it.
      const meta = await loadMeta(type, imdbId);
      if (!meta) return reply.code(404).send({ error: "Metadata not found" });

      const [cast, providers, recommendations, seasons, dropped] = await Promise.all([
        settled(loadCast(type, imdbId, request.log), { cast: [], director: null }),
        settled(loadProviders(type, imdbId, request.log), EMPTY_PROVIDERS),
        settled(loadRecommendations(request.params.type, type, imdbId), { metas: [] }),
        isSeries ? settled(loadSeasons(imdbId, request.log), []) : Promise.resolve([]),
        isSeries
          ? settled(
              prisma.kV
                .findUnique({ where: { key: droppedSeriesKey(profileId, imdbId) } })
                .then((row) => !!row),
              false
            )
          : Promise.resolve(false),
      ]);

      return {
        meta,
        cast: cast.cast,
        director: cast.director,
        providers,
        recommendations: recommendations.metas,
        seasons,
        dropped,
      };
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
