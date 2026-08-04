import { ListKind, MetadataType } from "@prisma/client";
import { STREAMING_PROVIDERS } from "../tmdb.js";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getTmdb } from "../lib/tmdb-client.js";
import { getRegionSetting } from "../lib/settings.js";
import { isAiConfigured, getAiRecommendations } from "../lib/ai.js";
import { getAddonConfig, ALL_ADDON_CATALOGS, addonConfigKey } from "../lib/addon.js";
import { trendingCacheGet, trendingCacheSet } from "../lib/cache.js";
import {
  getWatchlistMetas,
  getRecentMetas,
  getContinueMetas,
  getCustomListMetas,
} from "../lib/stremio-helpers.js";
import { upsertMetadata } from "../lib/metadata.js";
import { deriveStremioSecret, resolveProfileFromStremioSecret } from "../lib/stremio-secret.js";
import {
  getDefaultProfileId,
  isProfileLocked,
  PROFILE_LOCKED_RESPONSE,
  resolveProfile,
} from "../lib/profile.js";
import { parseMetaType, parseCatalogLimit, UUID_V4_PATTERN } from "../lib/types.js";
import type { StremioMetaPreview, StremioMetaType } from "../lib/types.js";
import type { MetadataPayload } from "../tmdb.js";

const STREMIO_ADDON_ID = "com.cataloggy.api";
const STREMIO_ADDON_VERSION = "1.0.0";

// Only set once this route has an actual place to send Stremio's
// "Configure" button — otherwise behaviorHints.configurable stays false
// even though catalog selection is possible via the web Settings page.
const CATALOGGY_WEB_PUBLIC = (process.env.CATALOGGY_WEB_PUBLIC ?? process.env.WEB_PUBLIC_BASE)?.replace(/\/+$/, "");

// Only used to hand Settings a ready-to-paste addon URL; the routes themselves
// never depend on knowing their own public address.
const CATALOGGY_API_PUBLIC = process.env.CATALOGGY_API_PUBLIC?.replace(/\/+$/, "");

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
  // The Stremio addon protocol (and the legacy catalog routes below) has no
  // concept of multiple profiles — there's no header or auth flow to carry
  // one through. We approximate multi-profile support by accepting an
  // optional `profileId` query string param (which a per-profile addon
  // manifest URL could embed) and otherwise falling back to the default
  // (oldest) profile, so existing single-profile installs keep working
  // unchanged.
  //
  // Returns null when the chosen profile is PIN-protected and the request has
  // not verified that PIN — the selector names a profile, it does not authorise
  // one. Holding `API_TOKEN` was otherwise enough to read a locked profile's
  // library through `?profileId=`, which is the boundary `resolveProfile`
  // enforces on the header path. Callers turn null into a 401.
  //
  // The `/addon/stremio/:secret/…` routes are deliberately not affected: they
  // resolve their profile from the secret in the path, which *is* the
  // credential — Stremio sends no headers and could never carry a PIN token.
  const resolveStremioProfileId = async (
    request: FastifyRequest,
    queryProfileId: unknown
  ): Promise<string | null> => {
    let profileId: string | null = null;
    if (typeof queryProfileId === "string" && UUID_V4_PATTERN.test(queryProfileId)) {
      const profile = await prisma.profile.findUnique({ where: { id: queryProfileId } });
      if (profile) profileId = profile.id;
    }
    profileId ??= await getDefaultProfileId();
    return (await isProfileLocked(request, profileId)) ? null : profileId;
  };

  // ─── Legacy stremio routes ───

  app.get<{ Querystring: { limit?: string; profileId?: string } }>(
    "/stremio/catalog/my_watchlist_movies",
    async (request, reply) => {
      const limit = parseCatalogLimit(request.query.limit);
      const profileId = await resolveStremioProfileId(request, request.query.profileId);
      if (!profileId) return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
      return { metas: await getWatchlistMetas("movie", limit, profileId) };
    }
  );

  app.get<{ Querystring: { limit?: string; profileId?: string } }>(
    "/stremio/catalog/my_watchlist_series",
    async (request, reply) => {
      const limit = parseCatalogLimit(request.query.limit);
      const profileId = await resolveStremioProfileId(request, request.query.profileId);
      if (!profileId) return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
      return { metas: await getWatchlistMetas("series", limit, profileId) };
    }
  );

  app.get<{ Querystring: { limit?: string; profileId?: string } }>(
    "/stremio/catalog/my_recent_movies",
    async (request, reply) => {
      const limit = parseCatalogLimit(request.query.limit);
      const profileId = await resolveStremioProfileId(request, request.query.profileId);
      if (!profileId) return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
      return { metas: await getRecentMetas("movie", limit, profileId) };
    }
  );

  app.get<{ Querystring: { limit?: string; profileId?: string } }>(
    "/stremio/catalog/my_continue_series",
    async (request, reply) => {
      const limit = parseCatalogLimit(request.query.limit);
      const profileId = await resolveStremioProfileId(request, request.query.profileId);
      if (!profileId) return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
      return { metas: await getContinueMetas(limit, profileId) };
    }
  );

  app.get<{ Params: { listId: string }; Querystring: { type?: string; limit?: string; profileId?: string } }>(
    "/stremio/list/:listId",
    async (request, reply) => {
      const type = parseMetaType(request.query.type);
      if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });

      if (!UUID_V4_PATTERN.test(request.params.listId)) {
        return reply.code(400).send({ error: "listId must be a valid UUID" });
      }

      // Scoped to the resolved profile, like every other route that serves list
      // contents. Looking a list up by id alone made this an IDOR: a caller who
      // knew (or guessed) a UUID could read a list belonging to a profile it was
      // not acting as, including a PIN-protected one.
      const profileId = await resolveStremioProfileId(request, request.query.profileId);
      if (!profileId) return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
      const list = await prisma.list.findFirst({
        where: { id: request.params.listId, profileId },
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

  app.get<{ Querystring: { type?: string; limit?: string; profileId?: string } }>(
    "/watchlist",
    async (request, reply) => {
      const type = parseMetaType(request.query.type);
      if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });
      const limit = parseCatalogLimit(request.query.limit);
      const profileId = await resolveStremioProfileId(request, request.query.profileId);
      if (!profileId) return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
      return { metas: await getWatchlistMetas(type, limit, profileId) };
    }
  );

  app.get<{ Querystring: { limit?: string; profileId?: string } }>("/continue", async (request, reply) => {
    const limit = parseCatalogLimit(request.query.limit);
    const profileId = await resolveStremioProfileId(request, request.query.profileId);
    if (!profileId) return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
    return { metas: await getContinueMetas(limit, profileId) };
  });

  app.get<{ Querystring: { type?: string; limit?: string; profileId?: string } }>(
    "/recent",
    async (request, reply) => {
      const type = parseMetaType(request.query.type);
      if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });
      const limit = parseCatalogLimit(request.query.limit);
      const profileId = await resolveStremioProfileId(request, request.query.profileId);
      if (!profileId) return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
      return { metas: await getRecentMetas(type, limit, profileId) };
    }
  );

  // ─── Addon Config ───

  // Both config routes are profile-scoped: the picker must only ever name the
  // requesting profile's custom lists (a PIN-protected profile's list names are
  // not the shared token holder's business), and enabling a catalog must not
  // enable it for everyone else on the install.
  app.get("/addon/config", { preHandler: resolveProfile }, async (request) => {
    const profileId = request.profileId as string;
    const config = await getAddonConfig(profileId);
    const userLists = await prisma.list.findMany({
      where: { kind: ListKind.custom, profileId },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    // The manifest URL carries this profile's addon secret, so it can only be
    // handed out from a route that already knows who is asking.
    const secret = deriveStremioSecret(profileId);
    const manifestPath = secret ? `/addon/stremio/${secret}/manifest.json` : null;
    return {
      config,
      availableCatalogs: ALL_ADDON_CATALOGS,
      availableLists: userLists,
      stremioManifestPath: manifestPath,
      stremioManifestUrl:
        manifestPath && CATALOGGY_API_PUBLIC ? `${CATALOGGY_API_PUBLIC}${manifestPath}` : null,
    };
  });

  app.post<{ Body: unknown }>("/addon/config", { preHandler: resolveProfile }, async (request, reply) => {
    const body = request.body as { enabledCatalogs?: unknown } | null;
    if (!body || !Array.isArray(body.enabledCatalogs)) {
      return reply.code(400).send({ error: "enabledCatalogs must be an array of strings" });
    }

    const profileId = request.profileId as string;
    const userLists = await prisma.list.findMany({
      where: { kind: ListKind.custom, profileId },
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
    const key = addonConfigKey(profileId);
    await prisma.kV.upsert({
      where: { key },
      create: { key, value: JSON.stringify(config), updatedAt: new Date() },
      update: { value: JSON.stringify(config), updatedAt: new Date() },
    });
    return { config };
  });

  // ─── Stremio Manifest ───
  //
  // Stremio installs one manifest URL and derives every other resource URL from
  // its base, so the addon secret lives in the path: `/addon/stremio/:secret/…`
  // is what a client installs, and the secret is both the credential (these
  // routes are the only ones exempt from the API token gate — see index.ts) and
  // the profile selector.
  //
  // The bare `/addon/stremio/…` paths stay registered for scripts that already
  // call them with a token and the legacy `?profileId` selector, but they are no
  // longer exempt from that gate, so they no longer hand a profile's library to
  // anyone who can reach the server.
  //
  // Sized for one Stremio home screen rather than one request: a client fetches
  // a catalog per entry the manifest advertises — 4 core plus up to 20 discovery
  // plus 2 per custom list — so a single refresh can be 25+ requests and the old
  // 60/min budget turned a second refresh in the same minute into 429s and empty
  // rows. Still well under the global default, and no help to anyone guessing at
  // a 256-bit secret.
  const PUBLIC_STREMIO_RATE_LIMIT = { max: 240, timeWindow: "1 minute" };

  const publicRoute = { config: { rateLimit: PUBLIC_STREMIO_RATE_LIMIT } };

  const configureHandler = async (_request: unknown, reply: FastifyReply) => {
    if (!CATALOGGY_WEB_PUBLIC) return reply.code(404).send({ error: "Not configured" });
    return reply.redirect(`${CATALOGGY_WEB_PUBLIC}/settings`);
  };

  app.get("/addon/stremio/configure", publicRoute, configureHandler);
  app.get<{ Params: { secret: string } }>(
    "/addon/stremio/:secret/configure",
    publicRoute,
    async (request, reply) => {
      const profileId = await resolveProfileFromStremioSecret(request.params.secret);
      if (!profileId) return reply.code(404).send({ error: "Unknown addon URL" });
      return configureHandler(request, reply);
    }
  );

  const buildManifest = async (profileId: string) => {
    const [config, aiConfigured] = await Promise.all([getAddonConfig(profileId), isAiConfigured()]);

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
        where: { id: { in: listIds }, profileId },
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
      ...(CATALOGGY_WEB_PUBLIC
        ? { behaviorHints: { configurable: true, configurationRequired: false } }
        : {}),
    };
  };

  app.get<{ Querystring: { profileId?: string } }>(
    "/addon/stremio/manifest.json",
    publicRoute,
    async (request, reply) => {
      const profileId = await resolveStremioProfileId(request, request.query.profileId);
      if (!profileId) return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
      return buildManifest(profileId);
    }
  );

  app.get<{ Params: { secret: string } }>(
    "/addon/stremio/:secret/manifest.json",
    publicRoute,
    async (request, reply) => {
      const profileId = await resolveProfileFromStremioSecret(request.params.secret);
      if (!profileId) return reply.code(404).send({ error: "Unknown addon URL" });
      return buildManifest(profileId);
    }
  );

  // ─── Stremio Catalog Handler ───

  const buildCatalog = async (profileId: string, rawType: string, catalogId: string, reply: FastifyReply) => {
    const type = parseMetaType(rawType);
    if (!type) return reply.code(400).send({ metas: [] });

    const limit = parseCatalogLimit(undefined);

    if (catalogId === "my_watchlist_movies") {
      if (type !== "movie") return reply.code(400).send({ metas: [] });
      return { metas: await getWatchlistMetas("movie", limit, profileId) };
    }
    if (catalogId === "my_watchlist_series") {
      if (type !== "series") return reply.code(400).send({ metas: [] });
      return { metas: await getWatchlistMetas("series", limit, profileId) };
    }
    if (catalogId === "my_recent_movies") {
      if (type !== "movie") return reply.code(400).send({ metas: [] });
      return { metas: await getRecentMetas("movie", limit, profileId) };
    }
    if (catalogId === "my_continue_series") {
      if (type !== "series") return reply.code(400).send({ metas: [] });
      return { metas: await getContinueMetas(limit, profileId) };
    }

    if (catalogId.startsWith("list:")) {
      const listId = catalogId.slice(5);
      // `List.id` is a Postgres uuid column, so a malformed id is a failed cast
      // — a 500 — rather than a miss. Same guard the legacy list route applies.
      if (!UUID_V4_PATTERN.test(listId)) return reply.code(404).send({ metas: [] });
      // Two checks, because ownership alone is not entitlement. The manifest
      // only advertises list catalogs the profile has explicitly enabled, so a
      // catalog id naming a list that is merely *owned* — never enabled — is a
      // URL no client should have, and one the addon never promised to serve.
      const config = await getAddonConfig(profileId);
      if (!config.enabledCatalogs.includes(catalogId)) return reply.code(404).send({ metas: [] });
      // Scoped to the resolved profile: the manifest only ever advertises that
      // profile's lists, so a UUID naming somebody else's list is not a list
      // this URL is entitled to serve.
      const list = await prisma.list.findFirst({
        where: { id: listId, profileId },
        select: { id: true },
      });
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
    // Trending/popular/anime/streaming are the same rows for everyone, so they
    // share one cache entry. The two personal catalogs are not: they are derived
    // from a profile's own history, so an unkeyed entry would serve whoever
    // asked first to everyone else — including out of a PIN-protected profile.
    if (cacheKey.startsWith("ai-recs:") || cacheKey.startsWith("recommended:")) {
      cacheKey = `${cacheKey}:${profileId}`;
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
        const result = await getAiRecommendations(aiType, 20, profileId);
        if (!result) return { metas: [] };
        return { metas: result.metas };
      } else if (cacheKey.startsWith("recommended:")) {
        if (await isAiConfigured()) {
          const aiResult = await getAiRecommendations(discovery.type, 20, profileId);
          if (aiResult) {
            trendingCacheSet(cacheKey, { data: aiResult.metas });
            return { metas: aiResult.metas };
          }
        }
        // Seeded from the requesting profile's own recent viewing — an
        // unfiltered read would recommend one person's titles to another and
        // leak what they have been watching.
        const recentItems =
          metaType === MetadataType.movie
            ? (
                await prisma.watchEvent.findMany({
                  where: { type: "movie", profileId },
                  orderBy: { watchedAt: "desc" },
                  take: 3,
                  distinct: ["imdbId"],
                  select: { imdbId: true },
                })
              ).map((r) => r.imdbId)
            : (
                await prisma.seriesProgress.findMany({
                  where: { profileId },
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
  };

  app.get<{ Params: { type: string; id: string }; Querystring: { skip?: string; profileId?: string } }>(
    "/addon/stremio/catalog/:type/:id.json",
    publicRoute,
    async (request, reply) => {
      const profileId = await resolveStremioProfileId(request, request.query.profileId);
      if (!profileId) return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
      return buildCatalog(profileId, request.params.type, request.params.id, reply);
    }
  );

  app.get<{ Params: { secret: string; type: string; id: string }; Querystring: { skip?: string } }>(
    "/addon/stremio/:secret/catalog/:type/:id.json",
    publicRoute,
    async (request, reply) => {
      const profileId = await resolveProfileFromStremioSecret(request.params.secret);
      if (!profileId) return reply.code(404).send({ metas: [] });
      return buildCatalog(profileId, request.params.type, request.params.id, reply);
    }
  );
};

export default stremioRoutes;
