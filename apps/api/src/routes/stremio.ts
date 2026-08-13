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
import type { StremioMetaPreview } from "../lib/types.js";
import type { MetadataPayload } from "../tmdb.js";
import {
  catalogRequiresAi,
  DISCOVERY_CATALOGS,
  getDiscoveryCatalog,
  listCatalogId,
  parseListCatalogId,
  selectDiscoveryCatalogs,
} from "@cataloggy/shared";
import type { AddonConfigResponse, DiscoveryCatalog } from "@cataloggy/shared";

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

// The catalog registry lives in @cataloggy/shared — see the module comment
// there for why. What stays here is the half only this service can know: how a
// catalog's rows are actually produced, and where they are cached.
//
// The keys are shared with the standalone /trending, /popular, /anime and
// /streaming routes, which build the same rows for the web UI, so whichever
// surface asks first fills the entry for both.
const discoveryCacheKey = (catalog: DiscoveryCatalog, profileId: string, region: string): string => {
  switch (catalog.source.kind) {
    case "trending":
      return `trending:${catalog.type}:week`;
    case "popular":
      return `popular:${catalog.type}`;
    case "anime":
      return `anime:${catalog.type}`;
    case "streaming":
      return `streaming:${catalog.source.provider}:${catalog.type}:${region}`;
    // Trending/popular/anime/streaming are the same rows for everyone. The two
    // personal catalogs are not: they are derived from a profile's own history,
    // so an unkeyed entry would serve whoever asked first to everyone else —
    // including out of a PIN-protected profile.
    case "ai":
      return `ai-recs:${catalog.type}:${profileId}`;
    case "recommended":
      return `recommended:${catalog.type}:${profileId}`;
  }
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
  app.get("/addon/config", { preHandler: resolveProfile }, async (request): Promise<AddonConfigResponse> => {
    const profileId = request.profileId as string;
    const [config, aiConfigured, userLists] = await Promise.all([
      getAddonConfig(profileId),
      isAiConfigured(),
      prisma.list.findMany({
        where: { kind: ListKind.custom, profileId },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    // The manifest URL carries this profile's addon secret, so it can only be
    // handed out from a route that already knows who is asking.
    const secret = deriveStremioSecret(profileId);
    const manifestPath = secret ? `/addon/stremio/${secret}/manifest.json` : null;
    return {
      config,
      // Labelled here rather than in the Settings picker: a fourth copy of the
      // catalog names is a fourth thing to keep in step.
      availableCatalogs: DISCOVERY_CATALOGS.map((catalog) => ({
        id: catalog.id,
        label: catalog.label,
        requiresAi: catalogRequiresAi(catalog),
      })),
      availableLists: userLists,
      // The addon service builds its manifest from this response, and it has to
      // drop the AI catalogs when there is no AI provider for the same reason
      // the manifest below does.
      aiConfigured,
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
      const listId = parseListCatalogId(c);
      return listId !== null && validListIds.has(listId);
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

    const catalogs: { id: string; type: string; name: string }[] = [
      ...CORE_STREMIO_CATALOGS.map((c) => ({ id: c.id, type: c.type, name: c.name })),
      ...selectDiscoveryCatalogs(config.enabledCatalogs, { aiConfigured }).map((catalog) => ({
        id: catalog.id,
        type: catalog.type,
        name: catalog.label,
      })),
    ];

    const listIds = config.enabledCatalogs
      .map(parseListCatalogId)
      .filter((id): id is string => id !== null);
    if (listIds.length > 0) {
      const userLists = await prisma.list.findMany({
        where: { id: { in: listIds }, profileId },
        select: { id: true, name: true },
      });
      const listById = new Map(userLists.map((l) => [l.id, l.name]));
      for (const listId of listIds) {
        const name = listById.get(listId);
        if (!name) continue;
        catalogs.push({ id: listCatalogId(listId), type: "movie", name: `${name} – Movies` });
        catalogs.push({ id: listCatalogId(listId), type: "series", name: `${name} – Series` });
      }
    }

    return {
      id: STREMIO_ADDON_ID,
      version: STREMIO_ADDON_VERSION,
      name: "Cataloggy",
      description: "Your personal media tracker – watchlists, history, and discovery catalogs.",
      // Stremio needs an absolute URL it can reach itself, so the mark can only
      // be offered once the web UI has a public address. Empty otherwise, which
      // is what this has always been — Stremio falls back to a generic tile.
      logo: CATALOGGY_WEB_PUBLIC ? `${CATALOGGY_WEB_PUBLIC}/icons/icon-192.png` : "",
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

    const listId = parseListCatalogId(catalogId);
    if (listId !== null) {
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

    const discovery = getDiscoveryCatalog(catalogId);
    if (!discovery) return reply.code(404).send({ metas: [] });
    if (discovery.type !== type) return reply.code(400).send({ metas: [] });

    // Only the streaming catalogs vary by region, and the setting is a DB read.
    const region = discovery.source.kind === "streaming" ? await getRegionSetting() : "";
    const cacheKey = discoveryCacheKey(discovery, profileId, region);
    const cached = trendingCacheGet(cacheKey);
    if (cached) return { metas: cached.data };

    try {
      const tmdb = await getTmdb();
      const metaType = discovery.type === "movie" ? MetadataType.movie : MetadataType.series;
      let results: MetadataPayload[];

      if (discovery.source.kind === "trending") {
        results = await tmdb.trending(metaType, "week");
      } else if (discovery.source.kind === "popular") {
        results = await tmdb.popular(metaType);
      } else if (discovery.source.kind === "ai") {
        const result = await getAiRecommendations(discovery.type, 20, profileId);
        if (!result) return { metas: [] };
        return { metas: result.metas };
      } else if (discovery.source.kind === "recommended") {
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
      } else if (discovery.source.kind === "anime") {
        results = await tmdb.discoverAnime(metaType);
      } else {
        const provider = STREAMING_PROVIDERS[discovery.source.provider];
        if (!provider) return { metas: [] };
        results = await tmdb.discoverByProvider(metaType, provider.id, region);
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
