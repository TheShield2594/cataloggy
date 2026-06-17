import { ListKind, MetadataType } from "@prisma/client";
import { STREAMING_PROVIDERS } from "../tmdb.js";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getTmdb } from "../lib/tmdb-client.js";
import { getRegionSetting } from "../lib/settings.js";
import { isAiConfigured, getAiRecommendations } from "../lib/ai.js";
import { getAddonConfig, ALL_ADDON_CATALOGS, ADDON_CONFIG_KEY } from "../lib/addon.js";
import { trendingCacheGet, trendingCacheSet } from "../lib/cache.js";
import {
  getWatchlistMetas,
  getRecentMetas,
  getContinueMetas,
  getCustomListMetas,
} from "../lib/stremio-helpers.js";
import { upsertMetadata } from "../lib/metadata.js";
import { parseMetaType, parseCatalogLimit, UUID_V4_PATTERN } from "../lib/types.js";
import type { StremioMetaPreview, StremioMetaType } from "../lib/types.js";
import type { MetadataPayload } from "../tmdb.js";

const STREMIO_ADDON_ID = "com.cataloggy.addon";
const STREMIO_ADDON_VERSION = "1.0.0";

const CORE_STREMIO_CATALOGS = [
  { id: "my_watchlist_movies", type: "movie" as const, name: "My Watchlist – Movies" },
  { id: "my_watchlist_series", type: "series" as const, name: "My Watchlist – Series" },
  { id: "my_recent_movies", type: "movie" as const, name: "Recently Watched Movies" },
  { id: "my_continue_series", type: "series" as const, name: "Continue Watching" },
];

const DISCOVERY_CATALOG_MAP: Record<string, { endpoint: string; type: StremioMetaType }> = {
  "cataloggy-trending-movie":     { endpoint: "trending:movie:week",     type: "movie" },
  "cataloggy-trending-series":    { endpoint: "trending:series:week",    type: "series" },
  "cataloggy-popular-movie":      { endpoint: "popular:movie",           type: "movie" },
  "cataloggy-popular-series":     { endpoint: "popular:series",          type: "series" },
  "cataloggy-recommended-movie":  { endpoint: "recommended:movie",       type: "movie" },
  "cataloggy-recommended-series": { endpoint: "recommended:series",      type: "series" },
  "cataloggy-ai-movie":           { endpoint: "ai-recs:movie",           type: "movie" },
  "cataloggy-ai-series":          { endpoint: "ai-recs:series",          type: "series" },
  "cataloggy-anime-series":       { endpoint: "anime:series",            type: "series" },
  "cataloggy-anime-movie":        { endpoint: "anime:movie",             type: "movie" },
  "cataloggy-netflix-movie":      { endpoint: "streaming:netflix:movie", type: "movie" },
  "cataloggy-netflix-series":     { endpoint: "streaming:netflix:series",type: "series" },
  "cataloggy-disney-movie":       { endpoint: "streaming:disney:movie",  type: "movie" },
  "cataloggy-disney-series":      { endpoint: "streaming:disney:series", type: "series" },
  "cataloggy-amazon-movie":       { endpoint: "streaming:amazon:movie",  type: "movie" },
  "cataloggy-amazon-series":      { endpoint: "streaming:amazon:series", type: "series" },
  "cataloggy-apple-movie":        { endpoint: "streaming:apple:movie",   type: "movie" },
  "cataloggy-apple-series":       { endpoint: "streaming:apple:series",  type: "series" },
  "cataloggy-max-movie":          { endpoint: "streaming:max:movie",     type: "movie" },
  "cataloggy-max-series":         { endpoint: "streaming:max:series",    type: "series" },
};

const DISCOVERY_CATALOG_LABELS: Record<string, string> = {
  "cataloggy-trending-movie":     "Trending Movies",
  "cataloggy-trending-series":    "Trending Series",
  "cataloggy-popular-movie":      "Popular Movies",
  "cataloggy-popular-series":     "Popular Series",
  "cataloggy-recommended-movie":  "Recommended Movies",
  "cataloggy-recommended-series": "Recommended Series",
  "cataloggy-ai-movie":           "AI Picks — Movies",
  "cataloggy-ai-series":          "AI Picks — Series",
  "cataloggy-anime-series":       "Anime",
  "cataloggy-anime-movie":        "Anime Movies",
  "cataloggy-netflix-movie":      "Netflix Movies",
  "cataloggy-netflix-series":     "Netflix Series",
  "cataloggy-disney-movie":       "Disney+ Movies",
  "cataloggy-disney-series":      "Disney+ Series",
  "cataloggy-amazon-movie":       "Prime Video Movies",
  "cataloggy-amazon-series":      "Prime Video Series",
  "cataloggy-apple-movie":        "Apple TV+ Movies",
  "cataloggy-apple-series":       "Apple TV+ Series",
  "cataloggy-max-movie":          "Max Movies",
  "cataloggy-max-series":         "Max Series",
};

const stremioRoutes: FastifyPluginAsync = async (app) => {
  // ─── Legacy stremio routes ───

  app.get<{ Querystring: { limit?: string } }>(
    "/stremio/catalog/my_watchlist_movies",
    async (request) => {
      const limit = parseCatalogLimit(request.query.limit);
      return { metas: await getWatchlistMetas("movie", limit) };
    }
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/stremio/catalog/my_watchlist_series",
    async (request) => {
      const limit = parseCatalogLimit(request.query.limit);
      return { metas: await getWatchlistMetas("series", limit) };
    }
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/stremio/catalog/my_recent_movies",
    async (request) => {
      const limit = parseCatalogLimit(request.query.limit);
      return { metas: await getRecentMetas("movie", limit) };
    }
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/stremio/catalog/my_continue_series",
    async (request) => {
      const limit = parseCatalogLimit(request.query.limit);
      return { metas: await getContinueMetas(limit) };
    }
  );

  app.get<{ Params: { listId: string }; Querystring: { type?: string; limit?: string } }>(
    "/stremio/list/:listId",
    async (request, reply) => {
      const type = parseMetaType(request.query.type);
      if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });

      if (!UUID_V4_PATTERN.test(request.params.listId)) {
        return reply.code(400).send({ error: "listId must be a valid UUID" });
      }

      const list = await prisma.list.findUnique({
        where: { id: request.params.listId },
        select: { id: true, kind: true },
      });

      if (!list || list.kind !== ListKind.custom) {
        return reply.code(404).send({ error: "Custom list not found" });
      }

      const limit = parseCatalogLimit(request.query.limit);
      return { metas: await getCustomListMetas(list.id, type, limit) };
    }
  );

  // ─── Watchlist / Recent / Continue ───

  app.get<{ Querystring: { type?: string; limit?: string } }>(
    "/watchlist",
    async (request, reply) => {
      const type = parseMetaType(request.query.type);
      if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });
      const limit = parseCatalogLimit(request.query.limit);
      return { metas: await getWatchlistMetas(type, limit) };
    }
  );

  app.get<{ Querystring: { limit?: string } }>("/continue", async (request) => {
    const limit = parseCatalogLimit(request.query.limit);
    return { metas: await getContinueMetas(limit) };
  });

  app.get<{ Querystring: { type?: string; limit?: string } }>(
    "/recent",
    async (request, reply) => {
      const type = parseMetaType(request.query.type);
      if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });
      const limit = parseCatalogLimit(request.query.limit);
      return { metas: await getRecentMetas(type, limit) };
    }
  );

  // ─── Addon Config ───

  app.get("/addon/config", async () => {
    const config = await getAddonConfig();
    const userLists = await prisma.list.findMany({
      where: { kind: ListKind.custom },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    return { config, availableCatalogs: ALL_ADDON_CATALOGS, availableLists: userLists };
  });

  app.post<{ Body: unknown }>("/addon/config", async (request, reply) => {
    const body = request.body as { enabledCatalogs?: unknown } | null;
    if (!body || !Array.isArray(body.enabledCatalogs)) {
      return reply.code(400).send({ error: "enabledCatalogs must be an array of strings" });
    }

    const userLists = await prisma.list.findMany({
      where: { kind: ListKind.custom },
      select: { id: true },
    });
    const validListIds = new Set(userLists.map((l) => l.id));

    const enabled = (body.enabledCatalogs as unknown[]).filter((c): c is string => {
      if (typeof c !== "string") return false;
      if (ALL_ADDON_CATALOGS.includes(c)) return true;
      if (c.startsWith("list:")) return validListIds.has(c.slice(5));
      return false;
    });

    const config = { enabledCatalogs: enabled };
    await prisma.kV.upsert({
      where: { key: ADDON_CONFIG_KEY },
      create: { key: ADDON_CONFIG_KEY, value: JSON.stringify(config), updatedAt: new Date() },
      update: { value: JSON.stringify(config), updatedAt: new Date() },
    });
    return { config };
  });

  // ─── Stremio Manifest ───
  // Stricter limit than the global default since this route is unauthenticated.
  const PUBLIC_STREMIO_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };

  app.get("/addon/stremio/manifest.json", { config: { rateLimit: PUBLIC_STREMIO_RATE_LIMIT } }, async () => {
    const [config, aiConfigured] = await Promise.all([getAddonConfig(), isAiConfigured()]);

    const enabledCatalogs = config.enabledCatalogs.filter((id) => {
      if (id === "cataloggy-ai-movie" || id === "cataloggy-ai-series") return aiConfigured;
      return true;
    });

    const catalogs: { id: string; type: string; name: string }[] = [
      ...CORE_STREMIO_CATALOGS.map((c) => ({ id: c.id, type: c.type, name: c.name })),
      ...enabledCatalogs
        .filter((id) => DISCOVERY_CATALOG_MAP[id])
        .map((id) => ({
          id,
          type: DISCOVERY_CATALOG_MAP[id].type,
          name: DISCOVERY_CATALOG_LABELS[id] ?? id,
        })),
    ];

    const listCatalogIds = enabledCatalogs.filter((id) => id.startsWith("list:"));
    if (listCatalogIds.length > 0) {
      const listIds = listCatalogIds.map((id) => id.slice(5));
      const userLists = await prisma.list.findMany({
        where: { id: { in: listIds } },
        select: { id: true, name: true },
      });
      const listById = new Map(userLists.map((l) => [l.id, l.name]));
      for (const listId of listIds) {
        const name = listById.get(listId);
        if (!name) continue;
        catalogs.push({ id: `list:${listId}`, type: "movie", name: `${name} – Movies` });
        catalogs.push({ id: `list:${listId}`, type: "series", name: `${name} – Series` });
      }
    }

    return {
      id: STREMIO_ADDON_ID,
      version: STREMIO_ADDON_VERSION,
      name: "Cataloggy",
      description: "Your personal media tracker – watchlists, history, and discovery catalogs.",
      logo: "",
      background: "",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs,
      behaviorHints: { configurable: false, configurationRequired: false },
    };
  });

  // ─── Stremio Catalog Handler ───

  app.get<{ Params: { type: string; id: string }; Querystring: { skip?: string } }>(
    "/addon/stremio/:type/catalog/:id.json",
    { config: { rateLimit: PUBLIC_STREMIO_RATE_LIMIT } },
    async (request, reply) => {
      const { type: rawType, id: catalogId } = request.params;
      const type = parseMetaType(rawType);
      if (!type) return reply.code(400).send({ metas: [] });

      const limit = parseCatalogLimit(undefined);

      if (catalogId === "my_watchlist_movies") {
        if (type !== "movie") return reply.code(400).send({ metas: [] });
        return { metas: await getWatchlistMetas("movie", limit) };
      }
      if (catalogId === "my_watchlist_series") {
        if (type !== "series") return reply.code(400).send({ metas: [] });
        return { metas: await getWatchlistMetas("series", limit) };
      }
      if (catalogId === "my_recent_movies") {
        if (type !== "movie") return reply.code(400).send({ metas: [] });
        return { metas: await getRecentMetas("movie", limit) };
      }
      if (catalogId === "my_continue_series") {
        if (type !== "series") return reply.code(400).send({ metas: [] });
        return { metas: await getContinueMetas(limit) };
      }

      if (catalogId.startsWith("list:")) {
        const listId = catalogId.slice(5);
        const list = await prisma.list.findUnique({ where: { id: listId }, select: { id: true } });
        if (!list) return reply.code(404).send({ metas: [] });
        return { metas: await getCustomListMetas(listId, type, limit) };
      }

      const discovery = DISCOVERY_CATALOG_MAP[catalogId];
      if (!discovery) return reply.code(404).send({ metas: [] });
      if (discovery.type !== type) return reply.code(400).send({ metas: [] });

      let cacheKey = discovery.endpoint;
      if (cacheKey.startsWith("streaming:")) {
        const region = await getRegionSetting();
        cacheKey = `${cacheKey}:${region}`;
      }
      const cached = trendingCacheGet(cacheKey);
      if (cached) return { metas: cached.data };

      try {
        const tmdb = await getTmdb();
        const metaType = discovery.type === "movie" ? MetadataType.movie : MetadataType.series;
        let results: MetadataPayload[];

        if (cacheKey.startsWith("trending:")) {
          const window = cacheKey.endsWith(":day") ? ("day" as const) : ("week" as const);
          results = await tmdb.trending(metaType, window);
        } else if (cacheKey.startsWith("popular:")) {
          results = await tmdb.popular(metaType);
        } else if (cacheKey.startsWith("ai-recs:")) {
          const aiType = cacheKey.split(":")[1] as "movie" | "series";
          const result = await getAiRecommendations(aiType, 20);
          if (!result) return { metas: [] };
          return { metas: result.metas };
        } else if (cacheKey.startsWith("recommended:")) {
          if (await isAiConfigured()) {
            const aiResult = await getAiRecommendations(discovery.type, 20);
            if (aiResult) {
              trendingCacheSet(cacheKey, { data: aiResult.metas });
              return { metas: aiResult.metas };
            }
          }
          const recentItems =
            metaType === MetadataType.movie
              ? (
                  await prisma.watchEvent.findMany({
                    where: { type: "movie" },
                    orderBy: { watchedAt: "desc" },
                    take: 3,
                    distinct: ["imdbId"],
                    select: { imdbId: true },
                  })
                ).map((r) => r.imdbId)
              : (
                  await prisma.seriesProgress.findMany({
                    orderBy: { lastWatchedAt: "desc" },
                    take: 3,
                    select: { seriesImdbId: true },
                  })
                ).map((r) => r.seriesImdbId);

          if (recentItems.length === 0) return { metas: [] };
          const seedMetas = await prisma.metadata.findMany({
            where: { imdbId: { in: recentItems }, type: metaType },
            select: { tmdbId: true },
          });
          const tmdbIds = seedMetas.filter((m) => m.tmdbId).map((m) => m.tmdbId as number);
          if (tmdbIds.length === 0) return { metas: [] };

          const seen = new Set<string>();
          const merged: MetadataPayload[] = [];
          for (const seedId of tmdbIds.slice(0, 3)) {
            const recs = await tmdb.recommendations(metaType, seedId);
            for (const r of recs) {
              if (!seen.has(r.imdbId)) {
                seen.add(r.imdbId);
                merged.push(r);
              }
            }
          }
          results = merged;
        } else if (cacheKey.startsWith("anime:")) {
          results = await tmdb.discoverAnime(metaType);
        } else if (cacheKey.startsWith("streaming:")) {
          const parts = cacheKey.split(":");
          const providerKey = parts[1];
          const provider = STREAMING_PROVIDERS[providerKey];
          if (!provider) return { metas: [] };
          const region = parts[parts.length - 1];
          results = await tmdb.discoverByProvider(metaType, provider.id, region);
        } else {
          return { metas: [] };
        }

        await Promise.all(results.map((r) => upsertMetadata(r)));
        const metas: StremioMetaPreview[] = results.map((r) => ({
          id: r.imdbId,
          type: discovery.type,
          name: r.name,
          poster: r.poster ?? undefined,
          year: r.year ?? undefined,
          description: r.description ?? undefined,
          genres: r.genres,
          rating: r.rating ?? undefined,
        }));
        trendingCacheSet(cacheKey, { data: metas });
        return { metas };
      } catch {
        return { metas: [] };
      }
    }
  );
};

export default stremioRoutes;
