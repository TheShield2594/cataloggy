import { createHmac, timingSafeEqual } from "node:crypto";
import { Sentry } from "./lib/sentry.js";
import Fastify, {
  type FastifyRequest,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
  type RouteGenericInterface,
  type RouteHandlerMethod,
} from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
  parseProxyPathPrefixes,
  normalizeProxyPath,
  parseTrustProxy,
  UUID_V4_PATTERN,
  deriveServiceToken,
  SERVICE_TOKEN_HEADER,
} from "@cataloggy/shared";

const CATALOGGY_API_BASE = process.env.CATALOGGY_API_BASE ?? "http://api:7000";
const CATALOGGY_API_TOKEN = process.env.CATALOGGY_API_TOKEN;
const ADDON_PUBLIC_BASE = process.env.ADDON_PUBLIC_BASE;
const WEB_PUBLIC_BASE = process.env.CATALOGGY_WEB_PUBLIC ?? process.env.WEB_PUBLIC_BASE;
const PROXY_PATH_PREFIXES = parseProxyPathPrefixes(process.env.PROXY_PATH_PREFIXES, ["/addon"] as const);

export const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  rewriteUrl: (request: RawRequestDefaultExpression) => normalizeProxyPath(request.url ?? "/", PROXY_PATH_PREFIXES)
});

// ─── Rate limiting ───
// All routes here are unauthenticated (Stremio doesn't send credentials), so apply a global limit.

app.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: "1 minute",
  keyGenerator: (request) => request.ip,
});

// ─── Error tracking (opt-in via SENTRY_DSN) ───

Sentry.setupFastifyErrorHandler(app);

// ─── Profile scoping ───
//
// Most API endpoints the addon calls are profile-scoped: the API's
// `resolveProfile` auto-picks a profile only when exactly one exists and
// otherwise demands an `x-profile-id` header. Without one, every call the
// addon makes — reading lists, personal recommendations, series progress, and
// crucially the /watch and /scrobble writes — starts failing the moment a
// second profile is created.
//
// Stremio has no notion of "who is watching": the installed URL is the only
// thing that distinguishes one installation from another, and Stremio derives
// every resource URL from the base of the manifest URL it was installed with.
// So the profile is bound to an *installation* via a path prefix —
// /p/<uuid>/manifest.json makes Stremio fetch /p/<uuid>/catalog/…,
// /p/<uuid>/meta/… and so on. Requests without the prefix (the URL every
// existing install already uses) fall back to the oldest profile, matching the
// default the API's own Stremio routes apply via `getDefaultProfileId`.
const PROFILE_ROUTE_PREFIX = "/p/:profileId";

// `profileId: null` means "no profile bound" — the header is omitted and the
// API applies its single-profile fallback.
type ProfileScope = { ok: true; profileId: string | null } | { ok: false };

const profilePathParam = (request: FastifyRequest): string | undefined => {
  const params = request.params as Record<string, unknown> | null;
  const value = params?.profileId;
  return typeof value === "string" ? value : undefined;
};

// ─── API helpers ───

// Proves these calls come from the addon rather than from a browser holding the
// same API token, so the API can rate-limit them separately — every Stremio
// client's requests reach the API from this one container's IP.
const SERVICE_TOKEN = CATALOGGY_API_TOKEN ? deriveServiceToken(CATALOGGY_API_TOKEN) : null;

const apiHeaders = (profileId?: string | null): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (SERVICE_TOKEN) headers[SERVICE_TOKEN_HEADER] = SERVICE_TOKEN;
  if (CATALOGGY_API_TOKEN) headers.Authorization = `Bearer ${CATALOGGY_API_TOKEN}`;
  if (profileId) headers["x-profile-id"] = profileId;
  return headers;
};

const FETCH_TIMEOUT_MS = 10_000;

const fetchWithTimeout = async (url: string | URL, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${String(url)} timed out after ${FETCH_TIMEOUT_MS}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const apiGet = async <T>(path: string, profileId?: string | null): Promise<T> => {
  const url = new URL(path, CATALOGGY_API_BASE);
  const response = await fetchWithTimeout(url, { headers: apiHeaders(profileId) });
  if (!response.ok) throw new Error(`API ${path} returned ${response.status}`);
  return response.json() as Promise<T>;
};

const apiPost = async <T>(path: string, body?: unknown, profileId?: string | null): Promise<T> => {
  const url = new URL(path, CATALOGGY_API_BASE);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      ...apiHeaders(profileId),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`API POST ${path} returned ${response.status}`);
  return response.json() as Promise<T>;
};

// GET /profiles is ordered oldest-first, so profiles[0] is the same profile the
// API's `getDefaultProfileId` would pick. Cached briefly so an un-prefixed
// install doesn't add a round trip to every request.
let cachedDefaultProfileId: { id: string | null; expiry: number } | null = null;
const DEFAULT_PROFILE_CACHE_TTL_MS = 60_000;

const fetchDefaultProfileId = async (): Promise<string | null> => {
  const now = Date.now();
  if (cachedDefaultProfileId && now < cachedDefaultProfileId.expiry) return cachedDefaultProfileId.id;

  try {
    const payload = await apiGet<{ profiles?: { id: string }[] }>("/profiles");
    const id = payload.profiles?.[0]?.id ?? null;
    cachedDefaultProfileId = { id, expiry: now + DEFAULT_PROFILE_CACHE_TTL_MS };
    return id;
  } catch (error) {
    app.log.warn(error, "Failed to fetch profiles, falling back to cached/absent profile");
    return cachedDefaultProfileId?.id ?? null;
  }
};

const resolveProfileScope = async (request: FastifyRequest): Promise<ProfileScope> => {
  const raw = profilePathParam(request);
  if (raw !== undefined) {
    // A malformed id is never silently swapped for the default profile —
    // serving one profile's data under another's URL is exactly the kind of
    // quiet wrong answer this scoping exists to prevent.
    if (!UUID_V4_PATTERN.test(raw)) return { ok: false };
    return { ok: true, profileId: raw };
  }
  return { ok: true, profileId: await fetchDefaultProfileId() };
};

// ─── Route registration ───

type AddonHandler<R extends RouteGenericInterface> = RouteHandlerMethod<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  R
>;

// Every Stremio-facing route is served both bare and under the per-profile
// prefix, so old installs keep working while new ones can pin a profile.
const addonGet = <R extends RouteGenericInterface>(path: string, handler: AddonHandler<R>) => {
  app.get<R>(path, handler);
  app.get<R>(`${PROFILE_ROUTE_PREFIX}${path}`, handler);
};

const addonPost = <R extends RouteGenericInterface>(path: string, handler: AddonHandler<R>) => {
  app.post<R>(path, handler);
  app.post<R>(`${PROFILE_ROUTE_PREFIX}${path}`, handler);
};

// ─── Types ───

type CataloggyList = {
  id: string;
  name: string;
  kind: "watchlist" | "custom";
};

type ListItemResponse = {
  imdbId: string;
  type: string;
  // Title captured when the item was added — stands in until the metadata row lands.
  title?: string | null;
  metadata: {
    name: string;
    poster: string | null;
    year: number | null;
    genres?: string[];
    rating?: number | null;
  } | null;
};

type StremioMetaPreview = {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape: "poster";
  genres?: string[];
};

type StremioSubtitle = {
  id: string;
  url: string;
  lang: string;
};

type RpdbConfig = {
  enabled: boolean;
  apiKey: string | null;
};

// ─── Caching ───
//
// Caches for genuinely global data (genres, RPDB config, the spoiler-protection
// preference) stay unkeyed. Anything derived from a profile-scoped endpoint —
// the manifest, which lists that profile's lists, the enabled-catalog config,
// and the discovery catalogs, which include personal recommendations — is
// keyed by profile so one profile never serves another's rows.

type CacheEntry<T> = { data: T; expiry: number };

const cacheKeyFor = (profileId: string | null) => profileId ?? "-";

// Profile ids reaching these maps are UUID-shaped but not verified to exist, so
// bound the maps rather than let unknown ids accumulate entries indefinitely.
const MAX_CACHE_ENTRIES = 512;

const cacheSet = <T>(cache: Map<string, CacheEntry<T>>, key: string, entry: CacheEntry<T>) => {
  cache.set(key, entry);
  if (cache.size > MAX_CACHE_ENTRIES) {
    // Map iterates in insertion order, so this drops the least recently added.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
};

const manifestCache = new Map<string, CacheEntry<object>>();
const MANIFEST_CACHE_TTL_MS = 60_000;

let cachedGenres: CacheEntry<string[]> | null = null;
const GENRES_CACHE_TTL_MS = 300_000;

let cachedRpdb: CacheEntry<RpdbConfig> | null = null;
const RPDB_CACHE_TTL_MS = 120_000;
const RPDB_BASE_URL = "https://api.ratingposterdb.com";

const trendingPopularCache = new Map<string, CacheEntry<StremioMetaPreview[]>>();
const TRENDING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Routes ───

app.get("/health", async () => ({ status: "ok", service: "addon", publicBase: ADDON_PUBLIC_BASE ?? null }));

const fetchAllLists = async (profileId: string | null): Promise<CataloggyList[]> => {
  const payload = await apiGet<{ lists?: CataloggyList[] }>("/lists", profileId);
  return payload.lists ?? [];
};

const fetchGenres = async (profileId: string | null): Promise<string[]> => {
  const now = Date.now();
  if (cachedGenres && now < cachedGenres.expiry) return cachedGenres.data;

  try {
    const payload = await apiGet<{ genres: string[] }>("/genres", profileId);
    cachedGenres = { data: payload.genres, expiry: now + GENRES_CACHE_TTL_MS };
    return payload.genres;
  } catch (error) {
    app.log.warn(error, "Failed to fetch genres, using cached value");
    return cachedGenres?.data ?? [];
  }
};

const fetchRpdbConfig = async (profileId: string | null): Promise<RpdbConfig> => {
  const now = Date.now();
  if (cachedRpdb && now < cachedRpdb.expiry) return cachedRpdb.data;

  try {
    const payload = await apiGet<RpdbConfig>("/rpdb/config", profileId);
    cachedRpdb = { data: payload, expiry: now + RPDB_CACHE_TTL_MS };
    return payload;
  } catch (error) {
    app.log.warn(error, "Failed to fetch RPDB config, using cached value");
    const fallback: RpdbConfig = { enabled: false, apiKey: null };
    return cachedRpdb?.data ?? fallback;
  }
};

const applyRpdbPoster = (imdbId: string, rpdbKey: string): string =>
  `${RPDB_BASE_URL}/${rpdbKey}/imdb/poster-default/${imdbId}.jpg`;

const applyRpdbToMetas = (metas: StremioMetaPreview[], rpdbKey: string | null): StremioMetaPreview[] => {
  if (!rpdbKey) return metas;
  return metas.map((meta) => ({
    ...meta,
    poster: applyRpdbPoster(meta.id, rpdbKey),
  }));
};

// ─── Trending/Popular catalog helpers ───

const DISCOVERY_CATALOGS = [
  { id: "cataloggy-trending-movie", type: "movie" as const, name: "Trending Movies", endpoint: "/trending?type=movie" },
  { id: "cataloggy-trending-series", type: "series" as const, name: "Trending Series", endpoint: "/trending?type=series" },
  { id: "cataloggy-popular-movie", type: "movie" as const, name: "Popular Movies", endpoint: "/popular?type=movie" },
  { id: "cataloggy-popular-series", type: "series" as const, name: "Popular Series", endpoint: "/popular?type=series" },
  { id: "cataloggy-recommended-movie", type: "movie" as const, name: "Recommended Movies", endpoint: "/recommendations/personal?type=movie" },
  { id: "cataloggy-recommended-series", type: "series" as const, name: "Recommended Series", endpoint: "/recommendations/personal?type=series" },
  { id: "cataloggy-anime-series", type: "series" as const, name: "Anime", endpoint: "/anime?type=series" },
  { id: "cataloggy-anime-movie", type: "movie" as const, name: "Anime Movies", endpoint: "/anime?type=movie" },
  { id: "cataloggy-netflix-movie", type: "movie" as const, name: "Netflix Movies", endpoint: "/streaming?type=movie&provider=netflix" },
  { id: "cataloggy-netflix-series", type: "series" as const, name: "Netflix Series", endpoint: "/streaming?type=series&provider=netflix" },
  { id: "cataloggy-disney-movie", type: "movie" as const, name: "Disney+ Movies", endpoint: "/streaming?type=movie&provider=disney" },
  { id: "cataloggy-disney-series", type: "series" as const, name: "Disney+ Series", endpoint: "/streaming?type=series&provider=disney" },
  { id: "cataloggy-amazon-movie", type: "movie" as const, name: "Prime Video Movies", endpoint: "/streaming?type=movie&provider=amazon" },
  { id: "cataloggy-amazon-series", type: "series" as const, name: "Prime Video Series", endpoint: "/streaming?type=series&provider=amazon" },
  { id: "cataloggy-apple-movie", type: "movie" as const, name: "Apple TV+ Movies", endpoint: "/streaming?type=movie&provider=apple" },
  { id: "cataloggy-apple-series", type: "series" as const, name: "Apple TV+ Series", endpoint: "/streaming?type=series&provider=apple" },
  { id: "cataloggy-max-movie", type: "movie" as const, name: "Max Movies", endpoint: "/streaming?type=movie&provider=max" },
  { id: "cataloggy-max-series", type: "series" as const, name: "Max Series", endpoint: "/streaming?type=series&provider=max" },
];

const isDiscoveryCatalog = (id: string) => DISCOVERY_CATALOGS.some((c) => c.id === id);
const getDiscoveryCatalog = (id: string) => DISCOVERY_CATALOGS.find((c) => c.id === id);

const fetchDiscoveryMetas = async (catalogId: string, profileId: string | null): Promise<StremioMetaPreview[]> => {
  const now = Date.now();
  const cacheKey = `${cacheKeyFor(profileId)}:${catalogId}`;
  const cached = trendingPopularCache.get(cacheKey);
  if (cached && now < cached.expiry) return cached.data;

  const catalog = getDiscoveryCatalog(catalogId);
  if (!catalog) return [];

  try {
    const payload = await apiGet<{ metas: Array<{ id: string; type: string; name: string; poster?: string; genres?: string[] }> }>(catalog.endpoint, profileId);
    const metas: StremioMetaPreview[] = (payload.metas ?? []).map((m) => ({
      id: m.id,
      type: m.type,
      name: m.name,
      ...(m.poster ? { poster: m.poster } : {}),
      posterShape: "poster" as const,
      ...(m.genres?.length ? { genres: m.genres } : {}),
    }));
    cacheSet(trendingPopularCache, cacheKey, { data: metas, expiry: now + TRENDING_CACHE_TTL_MS });
    return metas;
  } catch (error) {
    app.log.warn(error, `Failed to fetch discovery catalog ${catalogId}, using cached value`);
    return cached?.data ?? [];
  }
};

// ─── Manifest ───

// Fetch enabled catalogs from API. The config is per-profile, so the cache is
// keyed by profile too — otherwise the first profile to build a manifest would
// decide which catalogs every other profile sees for the next minute.
const enabledCatalogsCache = new Map<string, CacheEntry<string[]>>();
const ENABLED_CATALOGS_CACHE_TTL_MS = 60_000;

const fetchEnabledCatalogs = async (profileId: string | null): Promise<string[] | null> => {
  const now = Date.now();
  const cacheKey = cacheKeyFor(profileId);
  const cached = enabledCatalogsCache.get(cacheKey);
  if (cached && now < cached.expiry) return cached.data;

  try {
    const res = await apiGet<{ config: { enabledCatalogs: string[] } }>("/addon/config", profileId);
    const catalogs = res.config.enabledCatalogs;
    cacheSet(enabledCatalogsCache, cacheKey, { data: catalogs, expiry: now + ENABLED_CATALOGS_CACHE_TTL_MS });
    return catalogs;
  } catch (error) {
    app.log.warn(error, "Failed to fetch enabled catalogs, using cached value");
    return cached?.data ?? null;
  }
};

// Stremio's UI only renders a filter dropdown for the "genre" extra, so
// alphabetical sorting (which Stremio has no native concept of) is exposed
// as pseudo-genre options alongside the real content genres.
const SORT_OPTIONS = ["A-Z", "Z-A"];

const buildManifest = (lists: CataloggyList[], genres: string[], enabledCatalogs: string[] | null) => {
  const genreExtra = [{ name: "genre", options: [...SORT_OPTIONS, ...genres], isRequired: false }];

  const listCatalogs = lists.flatMap((list) => [
    {
      type: "movie" as const,
      id: `cataloggy-${list.id}-movie`,
      name: list.name,
      extra: [
        { name: "search", isRequired: false },
        ...genreExtra,
      ]
    },
    {
      type: "series" as const,
      id: `cataloggy-${list.id}-series`,
      name: list.name,
      extra: [
        { name: "search", isRequired: false },
        ...genreExtra,
      ]
    }
  ]);

  const discoveryCatalogs = DISCOVERY_CATALOGS.map((c) => ({
    type: c.type,
    id: c.id,
    name: c.name,
    extra: [
      { name: "search", isRequired: false },
      ...genreExtra,
    ],
  }));

  // Filter discovery catalogs by enabledCatalogs if available
  const filteredDiscovery = enabledCatalogs
    ? discoveryCatalogs.filter((c) => enabledCatalogs.includes(c.id))
    : discoveryCatalogs;

  const catalogs = [...listCatalogs, ...filteredDiscovery];

  const configUrl = WEB_PUBLIC_BASE ? `${WEB_PUBLIC_BASE}/settings` : undefined;

  return {
    id: "com.cataloggy.addon",
    version: "0.3.0",
    name: "Cataloggy",
    description: "Personal catalogs, tracking, and discovery powered by Cataloggy.",
    // `stream` is declared without Cataloggy ever providing a stream: the
    // request itself is the point. A client asks every installed addon for
    // streams the moment a user opens a title to watch it, and that request is
    // the only "about to play this" signal the protocol offers an addon that
    // isn't a stream provider. The reply is always an empty list, so nothing
    // extra appears in the client. See PLAY_DETECTION below.
    resources: ["catalog", "meta", "subtitles", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs,
    ...(configUrl ? {
      behaviorHints: { configurable: true, configurationRequired: false },
    } : {}),
  };
};

addonGet("/manifest.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  const scope = await resolveProfileScope(request);
  if (!scope.ok) return reply.code(404).send({ error: "Unknown profile in addon URL" });

  const now = Date.now();
  const cacheKey = cacheKeyFor(scope.profileId);
  const cached = manifestCache.get(cacheKey);
  if (cached && now < cached.expiry) {
    return reply.send(cached.data);
  }

  try {
    const [lists, genres, enabledCatalogs] = await Promise.all([
      fetchAllLists(scope.profileId),
      fetchGenres(scope.profileId),
      fetchEnabledCatalogs(scope.profileId),
    ]);
    const data = buildManifest(lists, genres, enabledCatalogs);
    cacheSet(manifestCache, cacheKey, { data, expiry: now + MANIFEST_CACHE_TTL_MS });
    return reply.send(data);
  } catch (error) {
    request.log.error(error, "Failed to fetch lists for manifest");
    return reply.code(502).send({ error: "Failed to build manifest" });
  }
});

// ─── Catalog routes ───

const parseCatalogId = (id: string) => {
  const match = id.match(/^cataloggy-([0-9a-f-]+)-(movie|series)$/i);
  if (!match) return null;
  return { listId: match[1], catalogType: match[2] };
};

const fetchListItems = async (listId: string, profileId: string | null): Promise<ListItemResponse[]> => {
  const payload = await apiGet<{ items?: ListItemResponse[] }>(`/lists/${encodeURIComponent(listId)}/items`, profileId);
  return payload.items ?? [];
};

const itemsToMetas = (items: ListItemResponse[], type: string): StremioMetaPreview[] =>
  items
    .filter((item) => item.type === type)
    .map((item) => ({
      id: item.imdbId,
      type: item.type,
      name: item.metadata?.name ?? item.title ?? item.imdbId,
      ...(item.metadata?.poster ? { poster: item.metadata.poster } : {}),
      posterShape: "poster" as const,
      ...(item.metadata?.genres?.length ? { genres: item.metadata.genres } : {}),
    }));

const parseExtra = (extra: string): Record<string, string> => {
  const params: Record<string, string> = {};
  for (const pair of extra.split("&")) {
    const [key, ...rest] = pair.split("=");
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(rest.join("="));
    }
  }
  return params;
};

const compareNames = (a: StremioMetaPreview, b: StremioMetaPreview): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

const applyExtraFilters = (metas: StremioMetaPreview[], extraParams: Record<string, string>): StremioMetaPreview[] => {
  let filtered = metas;

  if (extraParams.search) {
    const query = extraParams.search.toLowerCase();
    filtered = filtered.filter((m) => m.name.toLowerCase().includes(query));
  }

  if (extraParams.genre === "A-Z") {
    return [...filtered].sort(compareNames);
  }
  if (extraParams.genre === "Z-A") {
    return [...filtered].sort((a, b) => compareNames(b, a));
  }

  if (extraParams.genre) {
    const genre = extraParams.genre;
    filtered = filtered.filter((m) => m.genres?.includes(genre));
  }

  return filtered;
};

const handleCatalog = async (type: string, id: string, profileId: string | null, extra?: string) => {
  // Check discovery catalogs first
  if (isDiscoveryCatalog(id)) {
    const catalog = getDiscoveryCatalog(id);
    if (!catalog || catalog.type !== type) return { metas: [] };

    const rpdb = await fetchRpdbConfig(profileId);
    let metas = await fetchDiscoveryMetas(id, profileId);
    if (extra) {
      metas = applyExtraFilters(metas, parseExtra(extra));
    }
    return { metas: applyRpdbToMetas(metas, rpdb.apiKey) };
  }

  // User list catalogs
  const parsed = parseCatalogId(id);
  if (!parsed || type !== parsed.catalogType) return { metas: [] };

  const [items, rpdb] = await Promise.all([
    fetchListItems(parsed.listId, profileId),
    fetchRpdbConfig(profileId),
  ]);
  // Default to alphabetical order; Z-A/genre extras (if selected) override below.
  let metas = itemsToMetas(items, type).sort(compareNames);
  if (extra) {
    metas = applyExtraFilters(metas, parseExtra(extra));
  }
  return { metas: applyRpdbToMetas(metas, rpdb.apiKey) };
};

addonGet<{ Params: { type: string; id: string } }>("/catalog/:type/:id.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  const scope = await resolveProfileScope(request);
  if (!scope.ok) return reply.send({ metas: [] });

  try {
    return reply.send(await handleCatalog(request.params.type, request.params.id, scope.profileId));
  } catch (error) {
    request.log.error(error, "Failed to fetch catalog items");
    return reply.send({ metas: [] });
  }
});

addonGet<{ Params: { type: string; id: string; extra: string } }>("/catalog/:type/:id/:extra.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  const scope = await resolveProfileScope(request);
  if (!scope.ok) return reply.send({ metas: [] });

  try {
    return reply.send(await handleCatalog(request.params.type, request.params.id, scope.profileId, request.params.extra));
  } catch (error) {
    request.log.error(error, "Failed to fetch catalog items");
    return reply.send({ metas: [] });
  }
});

// ─── Spoiler protection helper ───

let cachedSpoilerProtection: CacheEntry<boolean> | null = null;
const SPOILER_CACHE_TTL_MS = 60_000;

const isSpoilerProtectionEnabled = async (profileId: string | null): Promise<boolean> => {
  const now = Date.now();
  if (cachedSpoilerProtection && now < cachedSpoilerProtection.expiry) {
    return cachedSpoilerProtection.data;
  }
  try {
    const prefs = await apiGet<{ spoilerProtection?: boolean }>("/settings/preferences", profileId);
    const enabled = prefs.spoilerProtection === true;
    cachedSpoilerProtection = { data: enabled, expiry: now + SPOILER_CACHE_TTL_MS };
    return enabled;
  } catch (error) {
    app.log.warn(error, "Failed to fetch spoiler protection setting, using cached value");
    return cachedSpoilerProtection?.data ?? false;
  }
};

// ─── Meta route (with ratings, genres, episode info, spoiler protection) ───

addonGet<{ Params: { type: string; id: string } }>("/meta/:type/:id.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  const { type, id } = request.params;

  if (type !== "movie" && type !== "series") {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  const imdbId = id.trim();
  if (!imdbId) {
    return reply.code(400).send({ error: "id is required" });
  }

  const scope = await resolveProfileScope(request);
  if (!scope.ok) return reply.code(404).send({ error: "Unknown profile in addon URL" });

  const apiUrl = new URL(`/meta/${type}/${encodeURIComponent(imdbId)}`, CATALOGGY_API_BASE);

  const [upstreamResponse, rpdb, spoilerEnabled] = await Promise.all([
    fetchWithTimeout(apiUrl, { headers: apiHeaders(scope.profileId) }),
    fetchRpdbConfig(scope.profileId),
    isSpoilerProtectionEnabled(scope.profileId),
  ]);
  const payload = await upstreamResponse.json().catch(() => ({}));

  if (!upstreamResponse.ok) {
    return reply.code(upstreamResponse.status).send(payload);
  }

  const releaseInfo = typeof payload.year === "number" ? String(payload.year) : undefined;
  const genres = Array.isArray(payload.genres) ? payload.genres : undefined;
  const rating = typeof payload.rating === "number" ? payload.rating : undefined;

  // Use RPDB poster if configured, otherwise fall back to TMDB poster
  const poster = rpdb.apiKey
    ? applyRpdbPoster(imdbId, rpdb.apiKey)
    : (typeof payload.poster === "string" ? payload.poster : undefined);

  // Spoiler protection: hide description for series the user hasn't finished
  let description = typeof payload.description === "string" ? payload.description : undefined;
  if (spoilerEnabled && type === "series" && description) {
    const spoilerMsg = "[Spoiler protection enabled — description hidden until you finish this series]";
    let shouldHide = true; // default: hide unless confirmed completed
    try {
      const progressRes = await apiGet<{
        progress?: { lastSeason: number; lastEpisode: number; totalEpisodes?: number | null; watchedEpisodes?: number | null };
      }>(`/series/progress/${encodeURIComponent(imdbId)}`, scope.profileId);
      if (progressRes.progress) {
        const { watchedEpisodes, totalEpisodes } = progressRes.progress;
        // Only show description if user has finished all episodes
        if (typeof watchedEpisodes === "number" && typeof totalEpisodes === "number" && watchedEpisodes >= totalEpisodes) {
          shouldHide = false;
        }
      }
      // No progress row = not started = hide
    } catch (error) {
      request.log.debug(error, "Failed to fetch series progress for spoiler check, hiding description");
    }
    if (shouldHide) {
      description = spoilerMsg;
    }
  }

  const meta: Record<string, unknown> = {
    id: imdbId,
    type,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name : imdbId,
    poster,
    background: typeof payload.background === "string" ? payload.background : undefined,
    description,
    releaseInfo,
    year: typeof payload.year === "number" ? payload.year : undefined,
  };

  if (genres?.length) meta.genres = genres;
  if (rating !== undefined) meta.imdbRating = String(rating);
  if (typeof payload.totalSeasons === "number") meta.totalSeasons = payload.totalSeasons;
  if (typeof payload.totalEpisodes === "number") meta.totalEpisodes = payload.totalEpisodes;

  return reply.send({ meta });
});

// ─── Play detection ───
//
// Addons are never told what was watched — a client only ever asks them for
// things. But two of those asks mean "the user is about to watch this":
// `stream` (they opened a title's stream list) and `subtitles` (a player
// loaded). Forwarding them lets Cataloggy infer watches from clients that keep
// their library entirely to themselves — Vidi, Omni, Nuvio and other
// addon-consuming apps that never sync to a Stremio account.
//
// Fire-and-forget on purpose: this must never delay or fail the response a
// client is waiting on. The API decides what to do with a signal (and drops it
// entirely unless play detection is enabled there) — this side only observes.
const PLAY_DETECTION = process.env.STREMIO_PLAY_DETECTION?.trim() === "true";

// Bounded here rather than at the API: this string is whatever a client chose
// to send, and it exists only to be read back in Settings.
const MAX_CLIENT_LENGTH = 200;

const forwardPlaySignal = (
  resource: "stream" | "subtitles",
  type: "movie" | "series",
  id: string,
  profileId: string | null,
  client: string | undefined
): void => {
  if (!PLAY_DETECTION) return;

  const parts = id.split(":");
  const imdbId = parts[0];
  if (!imdbId?.startsWith("tt")) return;

  const season = parts.length >= 3 ? Number.parseInt(parts[1], 10) : NaN;
  const episode = parts.length >= 3 ? Number.parseInt(parts[2], 10) : NaN;
  const isEpisode = type === "series" && Number.isInteger(season) && Number.isInteger(episode);

  // A bare series id means the user opened the show, not an episode — there is
  // nothing specific enough to record.
  if (type === "series" && !isEpisode) return;

  void apiPost(
    "/stremio/play-signal",
    {
      type: isEpisode ? "episode" : "movie",
      imdbId,
      ...(isEpisode ? { seriesImdbId: imdbId, season, episode } : {}),
      resource,
      // The player's own user-agent. Without forwarding it the API would only
      // ever see this service's fetch agent, which says nothing about which app
      // is actually watching — the one thing this field is for.
      ...(client?.trim() ? { client: client.trim().slice(0, MAX_CLIENT_LENGTH) } : {}),
    },
    profileId
  ).catch((error) => {
    app.log.warn({ error, resource, id }, "Failed to forward play signal");
  });
};

// Always an empty list — see the manifest comment on why this route exists.
addonGet<{ Params: { type: string; id: string } }>("/stream/:type/:id.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  const { type, id } = request.params;
  if (type === "movie" || type === "series") {
    const scope = await resolveProfileScope(request);
    if (scope.ok) forwardPlaySignal("stream", type, id, scope.profileId, request.headers["user-agent"]);
  }

  return reply.send({ streams: [] });
});

// ─── Subtitles route (mark as watched from Stremio) ───

addonGet<{ Params: { type: string; id: string } }>("/subtitles/:type/:id.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  const { type, id } = request.params;
  if (type !== "movie" && type !== "series") {
    return reply.send({ subtitles: [] });
  }

  // Parse IMDb ID — Stremio sends "tt1234567" for movies, "tt1234567:1:2" for episodes
  const parts = id.split(":");
  const imdbId = parts[0];
  if (!imdbId?.startsWith("tt")) {
    return reply.send({ subtitles: [] });
  }

  const scope = await resolveProfileScope(request);
  if (!scope.ok) return reply.send({ subtitles: [] });

  // A subtitles request means a player actually loaded, which is a stronger
  // play signal than the stream request that preceded it.
  forwardPlaySignal("subtitles", type, id, scope.profileId, request.headers["user-agent"]);

  const addonBase = ADDON_PUBLIC_BASE ?? `http://localhost:${process.env.PORT ?? 7001}`;
  const tokenQuery = MUTATION_TOKEN ? `?token=${MUTATION_TOKEN}` : "";
  // Pin the resolved profile into the mark-watched URL rather than leaving it
  // to be re-resolved later, so the write lands on the profile whose catalog
  // the user is actually looking at.
  const profileSegment = scope.profileId ? `/p/${scope.profileId}` : "";

  if (type === "movie") {
    const subtitles: StremioSubtitle[] = [{
      id: `cataloggy-watch-${imdbId}`,
      url: `${addonBase}${profileSegment}/mark-watched/${type}/${imdbId}.srt${tokenQuery}`,
      lang: "Cataloggy: Mark Watched",
    }];
    return reply.send({ subtitles });
  }

  // For series, include season/episode info if available
  if (type === "series" && parts.length >= 3) {
    const season = parseInt(parts[1], 10);
    const episode = parseInt(parts[2], 10);
    if (!isNaN(season) && !isNaN(episode)) {
      const subtitles: StremioSubtitle[] = [{
        id: `cataloggy-watch-${imdbId}-s${season}e${episode}`,
        url: `${addonBase}${profileSegment}/mark-watched/episode/${imdbId}/${season}/${episode}.srt${tokenQuery}`,
        lang: `Cataloggy: Mark S${season}E${episode} Watched`,
      }];
      return reply.send({ subtitles });
    }
  }

  return reply.send({ subtitles: [] });
});

// ─── Auth guard for mutation endpoints ───
// The addon's URL is necessarily shared (to install it in Stremio/Omni), so
// anyone who has it can reach these routes. An Origin-header check alone
// isn't real auth — it only stops browser-issued cross-origin requests;
// nothing stops a direct script/curl request from setting its own Origin
// header. So mutations additionally require a token derived from the shared
// CATALOGGY_API_TOKEN (never the raw token itself, to cap the blast radius
// if a URL containing it leaks — e.g. via proxy/access logs).
//
// Stremio's subtitle mechanism can only fetch a plain URL (no custom
// headers), so /mark-watched/*.srt carries the token as a query param,
// embedded server-side when the /subtitles route builds the URL. Scrobble
// callers (media-player integrations, capable of setting headers) send it
// as a standard Bearer token instead.
const MUTATION_TOKEN = CATALOGGY_API_TOKEN
  ? createHmac("sha256", CATALOGGY_API_TOKEN).update("cataloggy-addon-mutation").digest("hex")
  : null;

const isValidMutationToken = (candidate: unknown): boolean => {
  // Fastify doesn't validate query/header types against the route's TS generics at
  // runtime, so a repeated query param (e.g. "?token=a&token=b") can arrive here as
  // a string[] despite the declared type — guard explicitly rather than let
  // Buffer.from throw on a non-string value.
  if (!MUTATION_TOKEN || typeof candidate !== "string" || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(MUTATION_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

const STREMIO_WEB_ORIGINS = ["https://web.strem.io", "https://app.strem.io"];

const isAllowedMutationOrigin = (request: FastifyRequest): boolean => {
  const origin = request.headers.origin;
  if (!origin) return true;
  return STREMIO_WEB_ORIGINS.includes(origin);
};

// ─── Mark watched endpoints (return minimal SRT after recording) ───
//
// Stremio renders whatever comes back here as a subtitle line, which is the
// only feedback channel available — so it has to be truthful. Anything other
// than a recorded write says so explicitly rather than falling through to the
// success text.

const MINIMAL_SRT = `1
00:00:00,000 --> 00:00:03,000
Marked as watched on Cataloggy
`;

const SERIES_NO_EPISODE_SRT = `1
00:00:00,000 --> 00:00:03,000
Cannot mark a series as watched — select a specific episode first
`;

const WATCH_FAILED_SRT = `1
00:00:00,000 --> 00:00:05,000
Cataloggy could not record this — check the addon logs
`;

const REJECTED_SRT = `1
00:00:00,000 --> 00:00:05,000
Cataloggy rejected this request — reinstall the addon from Settings
`;

const UNKNOWN_PROFILE_SRT = `1
00:00:00,000 --> 00:00:05,000
Cataloggy profile not recognised — reinstall the addon from Settings
`;

addonGet<{ Params: { type: string; imdbId: string }; Querystring: { token?: string } }>(
  "/mark-watched/:type/:imdbId.srt",
  async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Content-Type", "text/srt; charset=utf-8");

    const { type, imdbId } = request.params;

    if (!isValidMutationToken(request.query.token) || !isAllowedMutationOrigin(request)) {
      request.log.warn({ origin: request.headers.origin }, "Rejected mark-watched request: missing/invalid token or disallowed origin");
      return reply.send(REJECTED_SRT);
    }

    if (type !== "movie") {
      // For series without episode info, return honest feedback instead of a silent no-op
      request.log.info({ type, imdbId }, "Series mark-watched requested without episode info — no-op");
      return reply.send(SERIES_NO_EPISODE_SRT);
    }

    const scope = await resolveProfileScope(request);
    if (!scope.ok) {
      request.log.warn({ imdbId }, "Rejected mark-watched request: malformed profile id in URL");
      return reply.send(UNKNOWN_PROFILE_SRT);
    }

    try {
      await apiPost("/watch", { type: "movie", imdbId }, scope.profileId);
    } catch (error) {
      request.log.error(error, "Failed to mark as watched");
      return reply.send(WATCH_FAILED_SRT);
    }

    request.log.info({ type, imdbId, profileId: scope.profileId }, "Marked as watched from Stremio");
    return reply.send(MINIMAL_SRT);
  }
);

addonGet<{ Params: { type: string; imdbId: string; season: string; episode: string }; Querystring: { token?: string } }>(
  "/mark-watched/:type/:imdbId/:season/:episode.srt",
  async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Content-Type", "text/srt; charset=utf-8");

    const { imdbId, season: seasonStr, episode: episodeStr } = request.params;
    const season = parseInt(seasonStr, 10);
    const episode = parseInt(episodeStr, 10);

    if (!isValidMutationToken(request.query.token) || !isAllowedMutationOrigin(request)) {
      request.log.warn({ origin: request.headers.origin }, "Rejected mark-watched request: missing/invalid token or disallowed origin");
      return reply.send(REJECTED_SRT);
    }

    const scope = await resolveProfileScope(request);
    if (!scope.ok) {
      request.log.warn({ imdbId, season, episode }, "Rejected mark-watched request: malformed profile id in URL");
      return reply.send(UNKNOWN_PROFILE_SRT);
    }

    try {
      await apiPost("/watch", {
        type: "episode",
        imdbId: `${imdbId}:${season}:${episode}`, // episode-level ID
        seriesImdbId: imdbId,
        season,
        episode,
      }, scope.profileId);
    } catch (error) {
      request.log.error(error, "Failed to mark episode as watched");
      return reply.send(WATCH_FAILED_SRT);
    }

    request.log.info({ imdbId, season, episode, profileId: scope.profileId }, "Marked episode as watched from Stremio");
    return reply.send(MINIMAL_SRT);
  }
);

// ─── Scrobble webhook (receives playback events from media players) ───

type ScrobbleAction = "start" | "pause" | "stop";

addonPost<{ Params: { action: string }; Body: unknown }>("/scrobble/:action", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");

  const action = request.params.action as ScrobbleAction;
  if (!["start", "pause", "stop"].includes(action)) {
    return reply.code(400).send({ error: "action must be one of: start, pause, stop" });
  }

  const authHeader = request.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : undefined;
  if (!isValidMutationToken(bearerToken) || !isAllowedMutationOrigin(request)) {
    request.log.warn({ origin: request.headers.origin }, "Rejected scrobble request: missing/invalid token or disallowed origin");
    return reply.code(403).send({ error: "Unauthorized" });
  }

  if (!request.body || typeof request.body !== "object") {
    return reply.code(400).send({ error: "Request body is required" });
  }

  const body = request.body as {
    imdbId?: unknown;
    type?: unknown;
    seriesImdbId?: unknown;
    season?: unknown;
    episode?: unknown;
    progress?: unknown;
  };

  if (typeof body.imdbId !== "string" || !body.imdbId.trim()) {
    return reply.code(400).send({ error: "imdbId is required" });
  }

  if (body.type !== "movie" && body.type !== "episode") {
    return reply.code(400).send({ error: "type must be one of: movie, episode" });
  }

  const scope = await resolveProfileScope(request);
  if (!scope.ok) {
    return reply.code(404).send({ error: "Unknown profile in addon URL" });
  }

  try {
    const result = await apiPost(`/scrobble/${action}`, {
      type: body.type,
      imdbId: body.imdbId,
      seriesImdbId: body.seriesImdbId ?? null,
      season: body.season ?? null,
      episode: body.episode ?? null,
      progress: body.progress ?? 0
    }, scope.profileId);
    return reply.send(result);
  } catch (error) {
    request.log.error(error, `Failed to forward scrobble/${action} to API`);
    return reply.code(502).send({ error: "Failed to forward scrobble event to API" });
  }
});

// ─── Configure page redirect ───

addonGet("/configure", async (_request, reply) => {
  if (WEB_PUBLIC_BASE) {
    return reply.redirect(`${WEB_PUBLIC_BASE}/settings`);
  }
  return reply.code(200).send({ message: "Configure Cataloggy through the web UI." });
});
