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

const apiGet = async <T>(path: string): Promise<T> => {
  const url = new URL(path, CATALOGGY_API_BASE);
  const response = await fetch(url, { headers: apiHeaders() });
  if (!response.ok) throw new Error(`API ${path} returned ${response.status}`);
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

type AddonConfig = {
  enabledCatalogs: string[];
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

const fetchAddonConfig = async (): Promise<AddonConfig> => {
  try {
    const payload = await apiGet<{ config: AddonConfig }>("/addon/config");
    return payload.config;
  } catch {
    return { enabledCatalogs: ["my_watchlist_movies", "my_watchlist_series", "my_recent_movies", "my_continue_series"] };
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

const buildManifest = (lists: CataloggyList[], genres: string[], _config: AddonConfig) => {
  const genreExtra = genres.length > 0
    ? [{ name: "genre", options: genres, isRequired: false }]
    : [];

  const catalogs = lists.flatMap((list) => [
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

  const configUrl = WEB_PUBLIC_BASE ? `${WEB_PUBLIC_BASE}/settings` : undefined;

  return {
    id: "com.cataloggy.addon",
    version: "0.2.0",
    name: "CataLoggy",
    description: "Personal catalogs powered by CataLoggy.",
    resources: ["catalog", "meta"],
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
    const [lists, genres, config] = await Promise.all([
      fetchAllLists(),
      fetchGenres(),
      fetchAddonConfig(),
    ]);
    const data = buildManifest(lists, genres, config);
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

app.get<{ Params: { type: string; id: string } }>("/catalog/:type/:id.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  const { type, id } = request.params;
  const parsed = parseCatalogId(id);

  if (!parsed || type !== parsed.catalogType) {
    return reply.code(200).send({ metas: [] });
  }

  try {
    const [items, rpdb] = await Promise.all([fetchListItems(parsed.listId), fetchRpdbConfig()]);
    const metas = applyRpdbToMetas(itemsToMetas(items, type), rpdb.apiKey);
    return reply.send({ metas });
  } catch (error) {
    request.log.error(error, "Failed to fetch catalog items");
    return reply.send({ metas: [] });
  }
});

app.get<{ Params: { type: string; id: string; extra: string } }>("/catalog/:type/:id/:extra.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  const { type, id, extra } = request.params;
  const parsed = parseCatalogId(id);

  if (!parsed || type !== parsed.catalogType) {
    return reply.send({ metas: [] });
  }

  try {
    const [items, rpdb] = await Promise.all([fetchListItems(parsed.listId), fetchRpdbConfig()]);
    const allMetas = itemsToMetas(items, type);
    const extraParams = parseExtra(extra);
    const metas = applyRpdbToMetas(applyExtraFilters(allMetas, extraParams), rpdb.apiKey);

    return reply.send({ metas });
  } catch (error) {
    request.log.error(error, "Failed to fetch catalog items");
    return reply.send({ metas: [] });
  }
});

// ─── Meta route (with ratings, genres, episode info) ───

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

  const [upstreamResponse, rpdb] = await Promise.all([
    fetch(apiUrl, { headers: apiHeaders() }),
    fetchRpdbConfig(),
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

  const meta: Record<string, unknown> = {
    id: imdbId,
    type,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name : imdbId,
    poster,
    background: typeof payload.background === "string" ? payload.background : undefined,
    description: typeof payload.description === "string" ? payload.description : undefined,
    releaseInfo,
    year: typeof payload.year === "number" ? payload.year : undefined,
  };

  if (genres?.length) meta.genres = genres;
  if (rating !== undefined) meta.imdbRating = String(rating);
  if (typeof payload.totalSeasons === "number") meta.totalSeasons = payload.totalSeasons;
  if (typeof payload.totalEpisodes === "number") meta.totalEpisodes = payload.totalEpisodes;

  return reply.send({ meta });
});

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
