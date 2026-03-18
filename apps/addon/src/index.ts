import Fastify, { type FastifyRequest, type FastifyReply, type RawRequestDefaultExpression } from "fastify";

const parseProxyPathPrefixes = (raw: string | undefined, fallback: readonly string[]) => {
  const parsed = (raw ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean)
    .map((prefix) => (prefix.startsWith("/") ? prefix : `/${prefix}`))
    .map((prefix) => (prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix));

  return parsed.length > 0 ? parsed : [...fallback];
};

const CATALOGGY_API_BASE = process.env.CATALOGGY_API ?? process.env.CATALOGGY_API_BASE ?? "http://api:7000";
const CATALOGGY_API_TOKEN = process.env.CATALOGGY_API_TOKEN;
const ADDON_PUBLIC_BASE = process.env.ADDON_PUBLIC_BASE;
const WEB_PUBLIC_BASE = process.env.CATALOGGY_WEB_PUBLIC ?? process.env.WEB_PUBLIC_BASE;
const PROXY_PATH_PREFIXES = parseProxyPathPrefixes(process.env.PROXY_PATH_PREFIXES, ["/addon"] as const);

const stripProxyPrefix = (url: string, prefix: string) => {
  if (url === prefix) {
    return "/";
  }

  if (!url.startsWith(`${prefix}/`)) {
    return null;
  }

  return url.slice(prefix.length) || "/";
};

const normalizeProxyPath = (rawUrl: string) => {
  for (const prefix of PROXY_PATH_PREFIXES) {
    const stripped = stripProxyPrefix(rawUrl, prefix);
    if (stripped) {
      return stripped;
    }
  }

  return rawUrl;
};

const app = Fastify({
  logger: true,
  rewriteUrl: (request: RawRequestDefaultExpression) => normalizeProxyPath(request.url ?? "/")
});

// ─── API helpers ───

const apiHeaders = (): Record<string, string> =>
  CATALOGGY_API_TOKEN ? { Authorization: `Bearer ${CATALOGGY_API_TOKEN}` } : {};

const FETCH_TIMEOUT_MS = 10_000;

const fetchWithTimeout = async (url: string | URL, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${String(url)} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const apiGet = async <T>(path: string): Promise<T> => {
  const url = new URL(path, CATALOGGY_API_BASE);
  const response = await fetchWithTimeout(url, { headers: apiHeaders() });
  if (!response.ok) throw new Error(`API ${path} returned ${response.status}`);
  return response.json() as Promise<T>;
};

const apiPost = async <T>(path: string, body?: unknown): Promise<T> => {
  const url = new URL(path, CATALOGGY_API_BASE);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      ...apiHeaders(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`API POST ${path} returned ${response.status}`);
  return response.json() as Promise<T>;
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

let cachedManifest: { data: object; expiry: number } | null = null;
const MANIFEST_CACHE_TTL_MS = 60_000;

let cachedGenres: { data: string[]; expiry: number } | null = null;
const GENRES_CACHE_TTL_MS = 300_000;

let cachedRpdb: { data: RpdbConfig; expiry: number } | null = null;
const RPDB_CACHE_TTL_MS = 120_000;
const RPDB_BASE_URL = "https://api.ratingposterdb.com";

type CacheEntry<T> = { data: T; expiry: number };
const trendingPopularCache = new Map<string, CacheEntry<StremioMetaPreview[]>>();
const TRENDING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Routes ───

app.get("/health", async () => ({ status: "ok", service: "addon", publicBase: ADDON_PUBLIC_BASE ?? null }));

const fetchAllLists = async (): Promise<CataloggyList[]> => {
  const payload = await apiGet<{ lists?: CataloggyList[] }>("/lists");
  return payload.lists ?? [];
};

const fetchGenres = async (): Promise<string[]> => {
  const now = Date.now();
  if (cachedGenres && now < cachedGenres.expiry) return cachedGenres.data;

  try {
    const payload = await apiGet<{ genres: string[] }>("/genres");
    cachedGenres = { data: payload.genres, expiry: now + GENRES_CACHE_TTL_MS };
    return payload.genres;
  } catch {
    return cachedGenres?.data ?? [];
  }
};

const fetchRpdbConfig = async (): Promise<RpdbConfig> => {
  const now = Date.now();
  if (cachedRpdb && now < cachedRpdb.expiry) return cachedRpdb.data;

  try {
    const payload = await apiGet<RpdbConfig>("/rpdb/config");
    cachedRpdb = { data: payload, expiry: now + RPDB_CACHE_TTL_MS };
    return payload;
  } catch {
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

const fetchDiscoveryMetas = async (catalogId: string): Promise<StremioMetaPreview[]> => {
  const now = Date.now();
  const cached = trendingPopularCache.get(catalogId);
  if (cached && now < cached.expiry) return cached.data;

  const catalog = getDiscoveryCatalog(catalogId);
  if (!catalog) return [];

  try {
    const payload = await apiGet<{ metas: Array<{ id: string; type: string; name: string; poster?: string; genres?: string[] }> }>(catalog.endpoint);
    const metas: StremioMetaPreview[] = (payload.metas ?? []).map((m) => ({
      id: m.id,
      type: m.type,
      name: m.name,
      ...(m.poster ? { poster: m.poster } : {}),
      posterShape: "poster" as const,
      ...(m.genres?.length ? { genres: m.genres } : {}),
    }));
    trendingPopularCache.set(catalogId, { data: metas, expiry: now + TRENDING_CACHE_TTL_MS });
    return metas;
  } catch {
    return cached?.data ?? [];
  }
};

// ─── Manifest ───

const buildManifest = (lists: CataloggyList[], genres: string[]) => {
  const genreExtra = genres.length > 0
    ? [{ name: "genre", options: genres, isRequired: false }]
    : [];

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

  const catalogs = [...listCatalogs, ...discoveryCatalogs];

  const configUrl = WEB_PUBLIC_BASE ? `${WEB_PUBLIC_BASE}/settings` : undefined;

  return {
    id: "com.cataloggy.addon",
    version: "0.3.0",
    name: "CataLoggy",
    description: "Personal catalogs, tracking, and discovery powered by CataLoggy.",
    resources: ["catalog", "meta", "subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs,
    ...(configUrl ? {
      behaviorHints: { configurable: true, configurationRequired: false },
    } : {}),
  };
};

app.get("/manifest.json", async (request: FastifyRequest, reply: FastifyReply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  const now = Date.now();
  if (cachedManifest && now < cachedManifest.expiry) {
    return reply.send(cachedManifest.data);
  }

  try {
    const [lists, genres] = await Promise.all([
      fetchAllLists(),
      fetchGenres(),
    ]);
    const data = buildManifest(lists, genres);
    cachedManifest = { data, expiry: now + MANIFEST_CACHE_TTL_MS };
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

const fetchListItems = async (listId: string): Promise<ListItemResponse[]> => {
  const payload = await apiGet<{ items?: ListItemResponse[] }>(`/lists/${encodeURIComponent(listId)}/items`);
  return payload.items ?? [];
};

const itemsToMetas = (items: ListItemResponse[], type: string): StremioMetaPreview[] =>
  items
    .filter((item) => item.type === type)
    .map((item) => ({
      id: item.imdbId,
      type: item.type,
      name: item.metadata?.name ?? item.imdbId,
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

const applyExtraFilters = (metas: StremioMetaPreview[], extraParams: Record<string, string>): StremioMetaPreview[] => {
  let filtered = metas;

  if (extraParams.search) {
    const query = extraParams.search.toLowerCase();
    filtered = filtered.filter((m) => m.name.toLowerCase().includes(query));
  }

  if (extraParams.genre) {
    const genre = extraParams.genre;
    filtered = filtered.filter((m) => m.genres?.includes(genre));
  }

  return filtered;
};

const handleCatalog = async (type: string, id: string, extra?: string) => {
  // Check discovery catalogs first
  if (isDiscoveryCatalog(id)) {
    const catalog = getDiscoveryCatalog(id);
    if (!catalog || catalog.type !== type) return { metas: [] };

    const rpdb = await fetchRpdbConfig();
    let metas = await fetchDiscoveryMetas(id);
    if (extra) {
      metas = applyExtraFilters(metas, parseExtra(extra));
    }
    return { metas: applyRpdbToMetas(metas, rpdb.apiKey) };
  }

  // User list catalogs
  const parsed = parseCatalogId(id);
  if (!parsed || type !== parsed.catalogType) return { metas: [] };

  const [items, rpdb] = await Promise.all([fetchListItems(parsed.listId), fetchRpdbConfig()]);
  let metas = itemsToMetas(items, type);
  if (extra) {
    metas = applyExtraFilters(metas, parseExtra(extra));
  }
  return { metas: applyRpdbToMetas(metas, rpdb.apiKey) };
};

app.get<{ Params: { type: string; id: string } }>("/catalog/:type/:id.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  try {
    return reply.send(await handleCatalog(request.params.type, request.params.id));
  } catch (error) {
    request.log.error(error, "Failed to fetch catalog items");
    return reply.send({ metas: [] });
  }
});

app.get<{ Params: { type: string; id: string; extra: string } }>("/catalog/:type/:id/:extra.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  try {
    return reply.send(await handleCatalog(request.params.type, request.params.id, request.params.extra));
  } catch (error) {
    request.log.error(error, "Failed to fetch catalog items");
    return reply.send({ metas: [] });
  }
});

// ─── Spoiler protection helper ───

let cachedSpoilerProtection: { data: boolean; expiry: number } | null = null;
const SPOILER_CACHE_TTL_MS = 60_000;

const isSpoilerProtectionEnabled = async (): Promise<boolean> => {
  const now = Date.now();
  if (cachedSpoilerProtection && now < cachedSpoilerProtection.expiry) {
    return cachedSpoilerProtection.data;
  }
  try {
    const prefs = await apiGet<{ spoilerProtection?: boolean }>("/settings/preferences");
    const enabled = prefs.spoilerProtection === true;
    cachedSpoilerProtection = { data: enabled, expiry: now + SPOILER_CACHE_TTL_MS };
    return enabled;
  } catch {
    return cachedSpoilerProtection?.data ?? false;
  }
};

// ─── Meta route (with ratings, genres, episode info, spoiler protection) ───

app.get<{ Params: { type: string; id: string } }>("/meta/:type/:id.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  const { type, id } = request.params;

  if (type !== "movie" && type !== "series") {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  const imdbId = id.trim();
  if (!imdbId) {
    return reply.code(400).send({ error: "id is required" });
  }

  const apiUrl = new URL(`/meta/${type}/${encodeURIComponent(imdbId)}`, CATALOGGY_API_BASE);

  const [upstreamResponse, rpdb, spoilerEnabled] = await Promise.all([
    fetchWithTimeout(apiUrl, { headers: apiHeaders() }),
    fetchRpdbConfig(),
    isSpoilerProtectionEnabled(),
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
    // Check if user is currently watching this series
    try {
      const progressRes = await apiGet<{
        progress?: { lastSeason: number; lastEpisode: number; totalEpisodes?: number | null; watchedEpisodes?: number | null };
      }>(`/series/progress/${encodeURIComponent(imdbId)}`);
      if (progressRes.progress) {
        const { watchedEpisodes, totalEpisodes } = progressRes.progress;
        // If user hasn't finished the series, redact the description
        if (typeof watchedEpisodes === "number" && typeof totalEpisodes === "number" && watchedEpisodes < totalEpisodes) {
          description = "[Spoiler protection enabled — description hidden until you finish this series]";
        }
      }
    } catch {
      // No progress found = user hasn't started, don't hide description
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

// ─── Subtitles route (mark as watched from Stremio) ───

app.get<{ Params: { type: string; id: string } }>("/subtitles/:type/:id.json", async (request, reply) => {
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

  const addonBase = ADDON_PUBLIC_BASE ?? `http://localhost:${process.env.PORT ?? 7001}`;

  if (type === "movie") {
    const subtitles: StremioSubtitle[] = [{
      id: `cataloggy-watch-${imdbId}`,
      url: `${addonBase}/mark-watched/${type}/${imdbId}.srt`,
      lang: "CataLoggy: Mark Watched",
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
        url: `${addonBase}/mark-watched/episode/${imdbId}/${season}/${episode}.srt`,
        lang: `CataLoggy: Mark S${season}E${episode} Watched`,
      }];
      return reply.send({ subtitles });
    }
  }

  return reply.send({ subtitles: [] });
});

// ─── Mark watched endpoints (return minimal SRT after recording) ───

const MINIMAL_SRT = `1
00:00:00,000 --> 00:00:03,000
Marked as watched on CataLoggy
`;

app.get<{ Params: { type: string; imdbId: string } }>("/mark-watched/:type/:imdbId.srt", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "text/srt; charset=utf-8");

  const { type, imdbId } = request.params;

  try {
    if (type === "movie") {
      await apiPost("/watch", { type: "movie", imdbId });
    }
    // For series without episode info, just log it
    request.log.info({ type, imdbId }, "Marked as watched from Stremio");
  } catch (error) {
    request.log.error(error, "Failed to mark as watched");
  }

  return reply.send(MINIMAL_SRT);
});

app.get<{ Params: { type: string; imdbId: string; season: string; episode: string } }>(
  "/mark-watched/:type/:imdbId/:season/:episode.srt",
  async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Content-Type", "text/srt; charset=utf-8");

    const { imdbId, season: seasonStr, episode: episodeStr } = request.params;
    const season = parseInt(seasonStr, 10);
    const episode = parseInt(episodeStr, 10);

    try {
      await apiPost("/watch", {
        type: "episode",
        imdbId: `${imdbId}:${season}:${episode}`, // episode-level ID
        seriesImdbId: imdbId,
        season,
        episode,
      });
      request.log.info({ imdbId, season, episode }, "Marked episode as watched from Stremio");
    } catch (error) {
      request.log.error(error, "Failed to mark episode as watched");
    }

    return reply.send(MINIMAL_SRT);
  }
);

// ─── Configure page redirect ───

app.get("/configure", async (_request: FastifyRequest, reply: FastifyReply) => {
  if (WEB_PUBLIC_BASE) {
    return reply.redirect(`${WEB_PUBLIC_BASE}/settings`);
  }
  return reply.code(200).send({ message: "Configure CataLoggy through the web UI." });
});

// ─── Start ───

const start = async () => {
  const port = Number(process.env.PORT ?? 7001);
  await app.listen({ port, host: "0.0.0.0" });
};

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Shutting down addon service");

  try {
    await app.close();
    app.log.info("Addon service shutdown complete");
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Error during addon shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
