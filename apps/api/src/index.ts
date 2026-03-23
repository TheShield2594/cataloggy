import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import { ItemType, ListItemType, ListKind, MetadataType, Prisma, PrismaClient, ScrobbleStatus, WatchEventType } from "@prisma/client";
import { TraktClient, computeTokenExpiresAt } from "./trakt.js";
import { CastMember, MetadataPayload, SeasonInfo, STREAMING_PROVIDERS, TmdbClient } from "./tmdb.js";

const prisma = new PrismaClient();

// ─── Language / preferences helpers ───

const LANGUAGE_KV_KEY = "settings:language";
const REGION_KV_KEY = "settings:region";
const SPOILER_PROTECTION_KV_KEY = "settings:spoilerProtection";

const getLanguageSetting = async (): Promise<string> => {
  const row = await prisma.kV.findUnique({ where: { key: LANGUAGE_KV_KEY } });
  return row?.value ?? "en-US";
};

const getRegionSetting = async (): Promise<string> => {
  const row = await prisma.kV.findUnique({ where: { key: REGION_KV_KEY } });
  return row?.value ?? "US";
};

const getSpoilerProtection = async (): Promise<boolean> => {
  const row = await prisma.kV.findUnique({ where: { key: SPOILER_PROTECTION_KV_KEY } });
  return row?.value === "true";
};

// ─── AI Provider Config ───

const AI_CONFIG_KEY = "ai:config";
const AI_LAST_RECS_GENERATED_AT_KEY = "ai:lastRecsGeneratedAt";

type AiProviderConfig = {
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
};

const getAiConfig = async (): Promise<AiProviderConfig | null> => {
  const row = await prisma.kV.findUnique({ where: { key: AI_CONFIG_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as AiProviderConfig;
  } catch {
    return null;
  }
};

const isAiConfigured = async (): Promise<boolean> => {
  const config = await getAiConfig();
  return !!(config?.url && config?.headers && config?.payload?.model);
};

const redactAiConfig = (config: AiProviderConfig): AiProviderConfig => ({
  ...config,
  headers: Object.fromEntries(
    Object.entries(config.headers).map(([k, v]) => [
      k,
      k.toLowerCase() === "authorization" ? "Bearer ****" : v,
    ])
  ),
});

const getTmdb = async () => {
  const lang = await getLanguageSetting();
  return TmdbClient.fromEnv(lang);
};

const htmlEscapeMap: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => htmlEscapeMap[ch]);
}

function renderOAuthHtml(detail: string, title = "Trakt Connection Failed"): string {
  return `<html><body style="background:#0f172a;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
  <div style="text-align:center"><h1>${title}</h1><p>${detail}</p><p style="color:#94a3b8;margin-top:1rem">You can close this tab and return to Cataloggy.</p></div>
</body></html>`;
}

const parseProxyPathPrefixes = (raw: string | undefined, fallback: readonly string[]) => {
  const parsed = (raw ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean)
    .map((prefix) => (prefix.startsWith("/") ? prefix : `/${prefix}`));

  return parsed.length > 0 ? parsed : [...fallback];
};

const PROXY_PATH_PREFIXES = parseProxyPathPrefixes(process.env.PROXY_PATH_PREFIXES, ["/api"] as const);

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
  rewriteUrl: (request) => normalizeProxyPath(request.url ?? "/")
});
let traktClient: TraktClient | null = null;

const getTraktClient = async () => {
  if (!traktClient) {
    traktClient = await TraktClient.create(prisma);
  }

  return traktClient;
};

const API_TOKEN = process.env.API_TOKEN;
const TRAKT_LAST_POLLED_AT_KEY = "trakt:lastPolledAt";
const TRAKT_POLL_INTERVAL_SEC = Number(process.env.TRAKT_POLL_INTERVAL_SEC ?? 300);
const AI_REFRESH_INTERVAL_SEC = Number(process.env.AI_REFRESH_INTERVAL_SEC ?? 86400);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";
const PRODUCTION_UI_ORIGIN = "https://cataloggy.domain.com";
const CATALOGGY_ALLOWED_ORIGINS = (process.env.CATALOGGY_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = IS_DEVELOPMENT
  ? ["*"]
  : Array.from(new Set([PRODUCTION_UI_ORIGIN, ...CATALOGGY_ALLOWED_ORIGINS]));
const CORS_METHODS = "GET,POST,DELETE,PATCH,OPTIONS";
const CORS_HEADERS = "Authorization,Content-Type";

type AuthenticatedRequest = FastifyRequest;
type StremioMetaType = "movie" | "series";
type StremioMetaPreview = {
  id: string;
  type: StremioMetaType;
  name: string;
  poster?: string;
  year?: number;
  description?: string;
  genres?: string[];
  rating?: number;
};

type ContinueMetaPreview = StremioMetaPreview & {
  extension: {
    season: number;
    episode: number;
  };
  lastWatched: {
    season: number;
    episode: number;
    lastWatchedAt: string;
  };
};

type SeriesProgressCandidate = {
  lastSeason: number;
  lastEpisode: number;
  lastWatchedAt: Date;
};

const DEFAULT_STREMIO_LIMIT = 50;
const MAX_STREMIO_LIMIT = 200;

const isLocalOrigin = (origin: string) => {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname.startsWith("192.168.")
      || hostname.startsWith("10.")
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  } catch {
    return false;
  }
};

const isAllowedOrigin = (origin: string | undefined) => {
  if (IS_DEVELOPMENT) {
    return true;
  }

  if (!origin) {
    return false;
  }

  return ALLOWED_ORIGINS.includes(origin) || isLocalOrigin(origin);
};

const applyCorsHeaders = (request: FastifyRequest, reply: FastifyReply) => {
  const origin = request.headers.origin;

  // Always allow CORS for local/private-network origins, and in dev mode.
  // For self-hosted setups where NODE_ENV may not be set, this ensures
  // the web UI can always reach the API on the same LAN.
  if (IS_DEVELOPMENT || (origin && isLocalOrigin(origin))) {
    reply.header("Access-Control-Allow-Origin", origin ?? "*");
    reply.header("Access-Control-Allow-Methods", CORS_METHODS);
    reply.header("Access-Control-Allow-Headers", CORS_HEADERS);
    return;
  }

  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return;
  }

  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Access-Control-Allow-Methods", CORS_METHODS);
  reply.header("Access-Control-Allow-Headers", CORS_HEADERS);
  reply.header("Vary", "Origin");
};

const toSha256Digest = (value: string) => createHash("sha256").update(value).digest();

const verifyToken = async (request: AuthenticatedRequest, reply: FastifyReply) => {
  if (!API_TOKEN) {
    request.log.error("API_TOKEN is not configured");
    return reply.code(500).send({ error: "API token is not configured" });
  }

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const tokenDigest = toSha256Digest(token);
  const expectedTokenDigest = toSha256Digest(API_TOKEN);

  if (!timingSafeEqual(tokenDigest, expectedTokenDigest)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
};

app.addHook("onRequest", async (request, reply) => {
  applyCorsHeaders(request, reply);

  if (request.method === "OPTIONS") {
    return reply.code(204).send();
  }
});

app.addHook("onRequest", async (request, reply) => {
  const url = request.url;

  if (url === "/health" || url.startsWith("/addon/stremio") || url === "/addon" || url.startsWith("/trakt/oauth/callback") || url.startsWith("/webhooks/")) {
    return;
  }

  await verifyToken(request, reply);
});


const getMetadataType = (rawType: string): MetadataType | null => {
  if (rawType === "movie") {
    return MetadataType.movie;
  }

  if (rawType === "series") {
    return MetadataType.series;
  }

  return null;
};

const upsertMetadata = async (metadata: MetadataPayload) => {
  const isDetailedPayload = metadata.totalSeasons !== null || metadata.totalEpisodes !== null
    || metadata.runtime !== null || metadata.certification !== null
    || metadata.status !== null || metadata.network !== null;

  const update: Record<string, unknown> = {
    tmdbId: metadata.tmdbId,
    name: metadata.name,
    year: metadata.year,
    poster: metadata.poster,
    background: metadata.background,
    description: metadata.description,
    genres: metadata.genres,
    rating: metadata.rating,
    voteCount: metadata.voteCount,
  };

  // Only mark as fresh when the payload includes detailed fields (from
  // findByImdbId), so partial search results don't prevent a later detail
  // fetch via syncMetadata's METADATA_FRESHNESS_MS check
  if (isDetailedPayload) {
    update.updatedAt = new Date();
    update.totalSeasons = metadata.totalSeasons;
    update.totalEpisodes = metadata.totalEpisodes;
    update.runtime = metadata.runtime;
    update.certification = metadata.certification;
    update.status = metadata.status;
    update.network = metadata.network;
    update.releaseDate = metadata.releaseDate;
  }

  return prisma.metadata.upsert({
    where: {
      imdbId_type: {
        imdbId: metadata.imdbId,
        type: metadata.type
      }
    },
    create: metadata,
    update
  });
};

const fetchMetadata = async (type: MetadataType, imdbId: string): Promise<MetadataPayload | null> => {
  const tmdb = await getTmdb();
  const metadata = await tmdb.findByImdbId(type, imdbId);

  if (!metadata) {
    return null;
  }

  await upsertMetadata(metadata);

  // Best-effort OMDB enrichment
  try {
    const omdbKey = await getOmdbApiKey();
    if (omdbKey) {
      const omdb = await fetchOmdbRatings(imdbId, omdbKey);
      await upsertOmdbRatings(imdbId, type, omdb);
    }
  } catch { /* ignore */ }

  return metadata;
};

const METADATA_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

const syncMetadata = async (imdbId: string, type: MetadataType) => {
  const existing = await prisma.metadata.findUnique({
    where: { imdbId_type: { imdbId, type } }
  });

  if (existing && Date.now() - existing.updatedAt.getTime() < METADATA_FRESHNESS_MS) {
    // Still refresh OMDB if not yet populated
    if (existing.imdbRating === null && existing.rtScore === null && existing.mcScore === null) {
      try {
        const omdbKey = await getOmdbApiKey();
        if (omdbKey) {
          const omdb = await fetchOmdbRatings(imdbId, omdbKey);
          return upsertOmdbRatings(imdbId, type, omdb);
        }
      } catch { /* ignore */ }
    }
    return existing;
  }

  const tmdb = await getTmdb();
  const payload = await tmdb.findByImdbId(type, imdbId);

  if (!payload) {
    return existing ?? null;
  }

  const row = await upsertMetadata(payload);

  try {
    const omdbKey = await getOmdbApiKey();
    if (omdbKey) {
      const omdb = await fetchOmdbRatings(imdbId, omdbKey);
      return upsertOmdbRatings(imdbId, type, omdb);
    }
  } catch { /* ignore */ }

  return row;
};

const parseCatalogLimit = (rawLimit: unknown) => {
  if (rawLimit === undefined) {
    return DEFAULT_STREMIO_LIMIT;
  }

  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_STREMIO_LIMIT;
  }

  return Math.min(parsed, MAX_STREMIO_LIMIT);
};

const parseMetaType = (rawType: unknown): StremioMetaType | null => {
  if (rawType === "movie" || rawType === "series") {
    return rawType;
  }

  return null;
};

const isIncomingSeriesProgressNewer = (
  existing: SeriesProgressCandidate,
  incoming: SeriesProgressCandidate
) => {
  const incomingTimestamp = incoming.lastWatchedAt.getTime();
  const existingTimestamp = existing.lastWatchedAt.getTime();

  if (incomingTimestamp !== existingTimestamp) {
    return incomingTimestamp > existingTimestamp;
  }

  if (incoming.lastSeason !== existing.lastSeason) {
    return incoming.lastSeason > existing.lastSeason;
  }

  return incoming.lastEpisode > existing.lastEpisode;
};

const upsertSeriesProgressIfNewer = async (seriesImdbId: string, incoming: SeriesProgressCandidate) => {
  const existing = await prisma.seriesProgress.findUnique({
    where: { seriesImdbId },
    select: {
      lastSeason: true,
      lastEpisode: true,
      lastWatchedAt: true
    }
  });

  if (!existing) {
    await prisma.seriesProgress.create({
      data: {
        seriesImdbId,
        lastSeason: incoming.lastSeason,
        lastEpisode: incoming.lastEpisode,
        lastWatchedAt: incoming.lastWatchedAt,
        updatedAt: incoming.lastWatchedAt
      }
    });

    return;
  }

  if (!isIncomingSeriesProgressNewer(existing, incoming)) {
    return;
  }

  await prisma.seriesProgress.update({
    where: { seriesImdbId },
    data: {
      lastSeason: incoming.lastSeason,
      lastEpisode: incoming.lastEpisode,
      lastWatchedAt: incoming.lastWatchedAt,
      updatedAt: incoming.lastWatchedAt
    }
  });
};

const buildMetasFromIds = async (ids: string[], type: StremioMetaType): Promise<StremioMetaPreview[]> => {
  if (ids.length === 0) {
    return [];
  }

  const itemType = type === "movie" ? ItemType.movie : ItemType.series;
  const metadataType = type === "movie" ? MetadataType.movie : MetadataType.series;
  const [items, metadata, rpdbKey] = await Promise.all([
    prisma.item.findMany({
      where: { type: itemType, imdbId: { in: ids } },
      select: { imdbId: true, title: true }
    }),
    prisma.metadata.findMany({
      where: { imdbId: { in: ids }, type: metadataType },
      select: { imdbId: true, name: true, poster: true, year: true, description: true, genres: true, rating: true }
    }),
    getRpdbApiKey(),
  ]);

  const titleByImdbId = new Map(items.map((item) => [item.imdbId, item.title?.trim() ?? ""]));
  const metadataByImdbId = new Map(metadata.map((entry) => [entry.imdbId, entry]));

  return ids.map((id) => {
    const meta = metadataByImdbId.get(id);

    return {
      id,
      type,
      name: titleByImdbId.get(id) || meta?.name || id,
      poster: withRpdbPoster(id, meta?.poster, rpdbKey) ?? undefined,
      year: meta?.year ?? undefined,
      description: meta?.description ?? undefined,
      genres: meta?.genres ?? [],
      rating: meta?.rating ?? undefined,
    };
  });
};

const getWatchlistMetas = async (type: StremioMetaType, limit: number) => {
  const watchlist = await getDefaultWatchlist();
  const listItemType = type === "movie" ? ListItemType.movie : ListItemType.series;

  const watchlistItems = await prisma.listItem.findMany({
    where: { listId: watchlist.id, type: listItemType },
    orderBy: { addedAt: "desc" },
    take: limit,
    select: { imdbId: true }
  });

  return buildMetasFromIds(
    watchlistItems.map((item) => item.imdbId),
    type
  );
};

const getRecentMetas = async (type: StremioMetaType, limit: number) => {
  if (type === "movie") {
    const groupedMovies = await prisma.watchEvent.groupBy({
      by: ["imdbId"],
      where: { type: "movie" },
      _max: { watchedAt: true },
      orderBy: { _max: { watchedAt: "desc" } },
      take: limit
    });

    return buildMetasFromIds(groupedMovies.map((event) => event.imdbId), type);
  }

  const groupedSeries = await prisma.watchEvent.groupBy({
    by: ["seriesImdbId"],
    where: {
      type: "episode",
      seriesImdbId: { not: null }
    },
    _max: { watchedAt: true },
    orderBy: { _max: { watchedAt: "desc" } },
    take: limit
  });

  const ids = groupedSeries.map((event) => event.seriesImdbId).filter((id): id is string => Boolean(id));

  return buildMetasFromIds(ids, type);
};

const getContinueMetas = async (limit: number): Promise<ContinueMetaPreview[]> => {
  const seriesProgress = await prisma.seriesProgress.findMany({
    orderBy: { lastWatchedAt: "desc" },
    take: limit,
    select: {
      seriesImdbId: true,
      lastSeason: true,
      lastEpisode: true,
      lastWatchedAt: true
    }
  });

  const metas = await buildMetasFromIds(
    seriesProgress.map((progress) => progress.seriesImdbId),
    "series"
  );

  const progressBySeriesId = new Map(seriesProgress.map((progress) => [progress.seriesImdbId, progress]));
  return metas
    .map((meta) => {
      const progress = progressBySeriesId.get(meta.id);
      if (!progress) {
        return null;
      }

      return {
        ...meta,
        extension: {
          season: progress.lastSeason,
          episode: progress.lastEpisode
        },
        lastWatched: {
          season: progress.lastSeason,
          episode: progress.lastEpisode,
          lastWatchedAt: progress.lastWatchedAt.toISOString()
        }
      };
    })
    .filter((meta): meta is ContinueMetaPreview => Boolean(meta));
};

const getCustomListMetas = async (listId: string, type: StremioMetaType, limit: number) => {
  const listItemType = type === "movie" ? ListItemType.movie : ListItemType.series;
  const listItems = await prisma.listItem.findMany({
    where: { listId, type: listItemType },
    orderBy: { addedAt: "desc" },
    take: limit,
    select: { imdbId: true }
  });

  return buildMetasFromIds(
    listItems.map((item) => item.imdbId),
    type
  );
};

const ensureDefaultWatchlist = async () => {
  await prisma.$transaction(
    async (tx) => {
      const defaultWatchlists = await tx.list.findMany({
        where: { kind: ListKind.watchlist, name: "Watchlist" },
        orderBy: { createdAt: "asc" }
      });

      if (defaultWatchlists.length === 0) {
        await tx.list.create({
          data: { kind: ListKind.watchlist, name: "Watchlist" }
        });
        return;
      }

      if (defaultWatchlists.length > 1) {
        const [, ...duplicates] = defaultWatchlists;
        await tx.list.deleteMany({
          where: { id: { in: duplicates.map((list) => list.id) } }
        });
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
};

const getDefaultWatchlist = async () => {
  const watchlist = await prisma.list.findFirst({
    where: { kind: ListKind.watchlist, name: "Watchlist" },
    orderBy: { createdAt: "asc" }
  });

  if (watchlist) {
    return watchlist;
  }

  return prisma.list.create({
    data: { kind: ListKind.watchlist, name: "Watchlist" }
  });
};

const getTraktPollStartAt = async () => {
  const kvValue = await prisma.kV.findUnique({ where: { key: TRAKT_LAST_POLLED_AT_KEY } });

  if (!kvValue) {
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  const parsed = new Date(kvValue.value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  return parsed;
};

const pollTraktHistory = async (logger: FastifyRequest["log"]) => {
  const client = await getTraktClient();
  const pollStartAt = await getTraktPollStartAt();
  const pollCompletedAt = new Date();
  const pollStartAtIso = pollStartAt.toISOString();

  const [movieHistory, episodeHistory] = await Promise.all([
    client.fetchMovieHistory(logger, pollStartAtIso),
    client.fetchEpisodeHistory(logger, pollStartAtIso)
  ]);

  const importedWatchEvents = { movies: 0, episodes: 0 };
  const seriesProgressByImdb = new Map<string, SeriesProgressCandidate>();

  for (const entry of movieHistory) {
    const imdbId = entry.movie?.ids?.imdb;
    const watchedAt = entry.watched_at;

    if (!imdbId || !watchedAt) {
      continue;
    }

    const watchedAtDate = new Date(watchedAt);
    const title = entry.movie?.title?.trim();
    if (title) {
      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.movie, imdbId } },
        create: { type: ItemType.movie, imdbId, title },
        update: { title }
      });
    }

    const existingEvent = await prisma.watchEvent.findFirst({
      where: {
        type: "movie",
        imdbId,
        watchedAt: watchedAtDate
      }
    });

    if (existingEvent) {
      await prisma.watchEvent.update({
        where: { id: existingEvent.id },
        data: { plays: 1 }
      });
    } else {
      await prisma.watchEvent.create({
        data: {
          type: "movie",
          imdbId,
          watchedAt: watchedAtDate,
          plays: 1
        }
      });
    }

    importedWatchEvents.movies += 1;
  }

  for (const entry of episodeHistory) {
    const episodeImdbId = entry.episode?.ids?.imdb;
    const seriesImdbId = entry.show?.ids?.imdb;
    const watchedAt = entry.watched_at;
    const season = entry.episode?.season;
    const episode = entry.episode?.number;

    if (!episodeImdbId || !seriesImdbId || !watchedAt || season === undefined || episode === undefined) {
      continue;
    }

    const watchedAtDate = new Date(watchedAt);
    const seriesTitle = entry.show?.title?.trim();
    if (seriesTitle) {
      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.series, imdbId: seriesImdbId } },
        create: { type: ItemType.series, imdbId: seriesImdbId, title: seriesTitle },
        update: { title: seriesTitle }
      });
    }

    const existingEvent = await prisma.watchEvent.findFirst({
      where: {
        type: "episode",
        imdbId: episodeImdbId,
        seriesImdbId,
        season,
        episode,
        watchedAt: watchedAtDate
      }
    });

    if (existingEvent) {
      await prisma.watchEvent.update({
        where: { id: existingEvent.id },
        data: { plays: 1 }
      });
    } else {
      await prisma.watchEvent.create({
        data: {
          type: "episode",
          imdbId: episodeImdbId,
          seriesImdbId,
          season,
          episode,
          watchedAt: watchedAtDate,
          plays: 1
        }
      });
    }

    const existing = seriesProgressByImdb.get(seriesImdbId);
    if (
      !existing ||
      watchedAtDate.getTime() > existing.lastWatchedAt.getTime() ||
      (watchedAtDate.getTime() === existing.lastWatchedAt.getTime() &&
        (season > existing.lastSeason || (season === existing.lastSeason && episode > existing.lastEpisode)))
    ) {
      seriesProgressByImdb.set(seriesImdbId, {
        lastSeason: season,
        lastEpisode: episode,
        lastWatchedAt: watchedAtDate
      });
    }

    importedWatchEvents.episodes += 1;
  }

  for (const [seriesImdbId, progress] of seriesProgressByImdb.entries()) {
    await upsertSeriesProgressIfNewer(seriesImdbId, progress);
  }

  await prisma.kV.upsert({
    where: { key: TRAKT_LAST_POLLED_AT_KEY },
    create: {
      key: TRAKT_LAST_POLLED_AT_KEY,
      value: pollCompletedAt.toISOString(),
      updatedAt: pollCompletedAt
    },
    update: {
      value: pollCompletedAt.toISOString(),
      updatedAt: pollCompletedAt
    }
  });

  return {
    since: pollStartAtIso,
    polledAt: pollCompletedAt.toISOString(),
    importedWatchEvents,
    updatedSeriesProgress: seriesProgressByImdb.size
  };
};


app.get<{ Querystring: { type?: string; query?: string; q?: string } }>("/search", async (request, reply) => {
  const rawType = request.query.type ?? "all";
  const isAll = rawType === "all";
  const type = isAll ? null : getMetadataType(rawType);
  if (!isAll && !type) {
    return reply.code(400).send({ error: "type must be one of: movie, series, all" });
  }

  const query = (request.query.q ?? request.query.query)?.trim();
  if (!query) {
    return reply.code(400).send({ error: "q or query is required" });
  }

  let tmdb: TmdbClient;
  try {
    tmdb = await getTmdb();
  } catch (error) {
    request.log.error(error, "TMDB client initialization failed");
    return reply.code(500).send({ error: "TMDB integration is not configured" });
  }

  const allResults = isAll
    ? await tmdb.searchMulti(query)
    : await tmdb.search(type!, query);

  const results = allResults.slice(0, 20);

  await Promise.all(results.map((result) => upsertMetadata(result)));

  const imdbIds = results.map((r) => r.imdbId);
  const resultTypes = [...new Set(results.map((r) => r.type as ListItemType))];

  const [listItems, rpdbKey] = await Promise.all([
    prisma.listItem.findMany({
      where: { imdbId: { in: imdbIds }, type: { in: resultTypes } },
      include: { list: { select: { id: true, name: true, kind: true } } }
    }),
    getRpdbApiKey(),
  ]);

  const listInfoKey = (imdbId: string, mediaType: string) => `${mediaType}:${imdbId}`;
  const listInfoByKey = new Map<string, { inWatchlist: boolean; lists: string[] }>();
  for (const item of listItems) {
    const key = listInfoKey(item.imdbId, item.type);
    let info = listInfoByKey.get(key);
    if (!info) {
      info = { inWatchlist: false, lists: [] };
      listInfoByKey.set(key, info);
    }
    if (item.list.kind === ListKind.watchlist) {
      info.inWatchlist = true;
    }
    info.lists.push(item.list.id);
  }

  return results.map((result) => {
    const info = listInfoByKey.get(listInfoKey(result.imdbId, result.type));
    return {
      imdbId: result.imdbId,
      type: result.type,
      name: result.name,
      year: result.year,
      poster: withRpdbPoster(result.imdbId, result.poster, rpdbKey),
      description: result.description,
      genres: result.genres,
      rating: result.rating,
      inWatchlist: info?.inWatchlist ?? false,
      lists: info?.lists ?? []
    };
  });
});

app.get<{ Params: { type: string; imdbId: string } }>("/meta/:type/:imdbId", async (request, reply) => {
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
    // After fetch, return the enriched DB row (includes OMDB ratings)
    const fresh = await prisma.metadata.findUnique({ where: { imdbId_type: { imdbId, type } } });
    return fresh
      ? { ...fresh, poster: withRpdbPoster(imdbId, fresh.poster, rpdbKey) }
      : { ...metadata, poster: withRpdbPoster(imdbId, metadata.poster, rpdbKey) };
  } catch (error) {
    request.log.error(error, "Metadata fetch failed");
    return reply.code(500).send({ error: "Metadata fetch failed" });
  }
});

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

// ─── Cast & Seasons (on-demand, in-memory cached) ───

const CAST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
type CastCacheEntry = { data: CastMember[]; expiry: number };
const castCache = new Map<string, CastCacheEntry>();

type SeasonsCacheEntry = { data: SeasonInfo[]; expiry: number };
const seasonsCache = new Map<string, SeasonsCacheEntry>();

app.get<{ Params: { type: string; imdbId: string } }>("/meta/:type/:imdbId/cast", async (request, reply) => {
  const type = getMetadataType(request.params.type);
  if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });

  const imdbId = request.params.imdbId.trim();
  const cacheKey = `cast:${type}:${imdbId}`;
  const now = Date.now();
  const cached = castCache.get(cacheKey);
  if (cached && now < cached.expiry) return { cast: cached.data };

  let meta = await prisma.metadata.findUnique({
    where: { imdbId_type: { imdbId, type } },
    select: { tmdbId: true },
  });

  if (!meta?.tmdbId) {
    await fetchMetadata(type, imdbId).catch(() => {});
    meta = await prisma.metadata.findUnique({ where: { imdbId_type: { imdbId, type } }, select: { tmdbId: true } });
  }

  if (!meta?.tmdbId) return { cast: [] };

  try {
    const tmdb = await getTmdb();
    const cast = await tmdb.getCast(type, meta.tmdbId);
    castCache.set(cacheKey, { data: cast, expiry: now + CAST_CACHE_TTL_MS });
    return { cast };
  } catch {
    return { cast: [] };
  }
});

app.get<{ Params: { imdbId: string } }>("/meta/series/:imdbId/seasons", async (request) => {
  const imdbId = request.params.imdbId.trim();
  const cacheKey = `seasons:${imdbId}`;
  const now = Date.now();
  const cached = seasonsCache.get(cacheKey);
  if (cached && now < cached.expiry) return { seasons: cached.data };

  let meta = await prisma.metadata.findUnique({
    where: { imdbId_type: { imdbId, type: "series" } },
    select: { tmdbId: true },
  });

  if (!meta?.tmdbId) {
    await fetchMetadata("series", imdbId).catch(() => {});
    meta = await prisma.metadata.findUnique({ where: { imdbId_type: { imdbId, type: "series" } }, select: { tmdbId: true } });
  }

  if (!meta?.tmdbId) return { seasons: [] };

  try {
    const tmdb = await getTmdb();
    const seasons = await tmdb.getSeasons(meta.tmdbId);
    seasonsCache.set(cacheKey, { data: seasons, expiry: now + CAST_CACHE_TTL_MS });
    return { seasons };
  } catch {
    return { seasons: [] };
  }
});

// ─── Drop Show ───

const DROPPED_KEY = (imdbId: string) => `dropped:series:${imdbId}`;

app.get<{ Params: { imdbId: string } }>("/show/:imdbId/dropped", async (request) => {
  const row = await prisma.kV.findUnique({ where: { key: DROPPED_KEY(request.params.imdbId) } });
  return { dropped: !!row };
});

app.post<{ Params: { imdbId: string } }>("/show/:imdbId/drop", async (request) => {
  await prisma.kV.upsert({
    where: { key: DROPPED_KEY(request.params.imdbId) },
    create: { key: DROPPED_KEY(request.params.imdbId), value: "true", updatedAt: new Date() },
    update: { value: "true", updatedAt: new Date() },
  });
  return { dropped: true };
});

app.delete<{ Params: { imdbId: string } }>("/show/:imdbId/drop", async (request) => {
  await prisma.kV.deleteMany({ where: { key: DROPPED_KEY(request.params.imdbId) } });
  return { dropped: false };
});

// ─── Delete Watch Event ───

app.delete<{ Params: { eventId: string } }>("/watch/:eventId", async (request, reply) => {
  const { eventId } = request.params;
  try {
    await prisma.$transaction(async (tx) => {
      const event = await tx.watchEvent.findUnique({ where: { id: eventId } });
      if (!event) throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });

      await tx.watchEvent.delete({ where: { id: eventId } });

      // Repair seriesProgress when an episode is deleted
      if (event.type === "episode" && event.seriesImdbId) {
        const latest = await tx.watchEvent.findFirst({
          where: { seriesImdbId: event.seriesImdbId, type: "episode", season: { not: null }, episode: { not: null } },
          orderBy: { watchedAt: "desc" },
        });

        if (latest && latest.season != null && latest.episode != null) {
          await tx.seriesProgress.update({
            where: { seriesImdbId: event.seriesImdbId },
            data: { lastSeason: latest.season, lastEpisode: latest.episode, lastWatchedAt: latest.watchedAt, updatedAt: new Date() },
          });
        } else {
          await tx.seriesProgress.deleteMany({ where: { seriesImdbId: event.seriesImdbId } });
        }
      }
    });
    return reply.code(204).send();
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "NOT_FOUND") {
      return reply.code(404).send({ error: "Watch event not found" });
    }
    throw err;
  }
});

// ─── Check-in ───

const CHECKIN_KV_KEY = "checkin:active";

type CheckInData = {
  type: "movie" | "episode";
  imdbId: string;
  seriesImdbId?: string;
  name: string;
  poster?: string;
  season?: number;
  episode?: number;
  startedAt: string;
  expiresAt?: string;
};

app.get("/checkin", async () => {
  const row = await prisma.kV.findUnique({ where: { key: CHECKIN_KV_KEY } });
  if (!row) return { checkin: null };
  try {
    return { checkin: JSON.parse(row.value) as CheckInData };
  } catch {
    return { checkin: null };
  }
});

app.post<{ Body: { type: "movie" | "episode"; imdbId: string; seriesImdbId?: string; name: string; poster?: string; season?: number; episode?: number; runtime?: number } }>(
  "/checkin",
  async (request) => {
    const { type, imdbId, seriesImdbId, name, poster, season, episode, runtime } = request.body;
    const startedAt = new Date().toISOString();
    const expiresAt = runtime ? new Date(Date.now() + runtime * 60 * 1000).toISOString() : undefined;
    const checkin: CheckInData = { type, imdbId, seriesImdbId, name, poster, season, episode, startedAt, expiresAt };
    await prisma.kV.upsert({
      where: { key: CHECKIN_KV_KEY },
      create: { key: CHECKIN_KV_KEY, value: JSON.stringify(checkin), updatedAt: new Date() },
      update: { value: JSON.stringify(checkin), updatedAt: new Date() },
    });
    return { checkin };
  }
);

app.delete<{ Querystring: { log?: string } }>("/checkin", async (request, reply) => {
  const row = await prisma.kV.findUnique({ where: { key: CHECKIN_KV_KEY } });
  if (row && request.query.log === "true") {
    try {
      const checkin = JSON.parse(row.value) as CheckInData;
      const seriesImdbId = checkin.seriesImdbId ?? checkin.imdbId;
      await recordWatchEvent({
        type: checkin.type,
        imdbId: checkin.type === "movie" ? checkin.imdbId : seriesImdbId,
        seriesImdbId: checkin.type === "episode" ? seriesImdbId : undefined,
        season: checkin.type === "episode" ? (checkin.season ?? null) : undefined,
        episode: checkin.type === "episode" ? (checkin.episode ?? null) : undefined,
        watchedAt: new Date(),
        source: "checkin",
        request,
      });
    } catch { /* best-effort */ }
  }
  await prisma.kV.deleteMany({ where: { key: CHECKIN_KV_KEY } });
  return reply.code(204).send();
});

// ─── Trending / Popular (TMDB) ───

type TrendingCacheEntry = { data: StremioMetaPreview[]; expiry: number; reasons?: Record<string, string> };
const trendingCache = new Map<string, TrendingCacheEntry>();
const TRENDING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TRENDING_CACHE_SIZE = 100;

// TTL-aware cache helpers
const trendingCacheGet = (key: string): TrendingCacheEntry | undefined => {
  const entry = trendingCache.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiry) {
    trendingCache.delete(key);
    return undefined;
  }
  return entry;
};

const trendingCacheSet = (key: string, entry: TrendingCacheEntry) => {
  // Evict oldest entries if at capacity
  if (trendingCache.size >= MAX_TRENDING_CACHE_SIZE && !trendingCache.has(key)) {
    const oldest = trendingCache.keys().next().value;
    if (oldest !== undefined) trendingCache.delete(oldest);
  }
  trendingCache.set(key, entry);
};

app.get<{ Querystring: { type?: string; window?: string } }>("/trending", async (request, reply) => {
  const rawType = request.query.type ?? "movie";
  const type = getMetadataType(rawType);
  if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });

  const timeWindow = request.query.window === "day" ? "day" as const : "week" as const;
  const cacheKey = `trending:${rawType}:${timeWindow}`;
  const now = Date.now();
  const [cached, rpdbKey] = await Promise.all([Promise.resolve(trendingCacheGet(cacheKey)), getRpdbApiKey()]);
  if (cached && now < cached.expiry) return { metas: applyRpdbToMetaList(cached.data, rpdbKey) };

  try {
    const tmdb = await getTmdb();
    const results = await tmdb.trending(type, timeWindow);
    // Cache metadata for each item
    await Promise.all(results.map((r) => upsertMetadata(r)));
    const metas: StremioMetaPreview[] = results.map((r) => ({
      id: r.imdbId,
      type: rawType as StremioMetaType,
      name: r.name,
      poster: r.poster ?? undefined,
      year: r.year ?? undefined,
      description: r.description ?? undefined,
      genres: r.genres,
      rating: r.rating ?? undefined,
    }));
    trendingCacheSet(cacheKey, { data: metas, expiry: now + TRENDING_CACHE_TTL_MS });
    return { metas: applyRpdbToMetaList(metas, rpdbKey) };
  } catch (error) {
    request.log.error(error, "Trending fetch failed");
    return reply.code(500).send({ error: "Failed to fetch trending content" });
  }
});

app.get<{ Querystring: { type?: string } }>("/popular", async (request, reply) => {
  const rawType = request.query.type ?? "movie";
  const type = getMetadataType(rawType);
  if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });

  const cacheKey = `popular:${rawType}`;
  const now = Date.now();
  const [cached, rpdbKey] = await Promise.all([Promise.resolve(trendingCacheGet(cacheKey)), getRpdbApiKey()]);
  if (cached && now < cached.expiry) return { metas: applyRpdbToMetaList(cached.data, rpdbKey) };

  try {
    const tmdb = await getTmdb();
    const results = await tmdb.popular(type);
    await Promise.all(results.map((r) => upsertMetadata(r)));
    const metas: StremioMetaPreview[] = results.map((r) => ({
      id: r.imdbId,
      type: rawType as StremioMetaType,
      name: r.name,
      poster: r.poster ?? undefined,
      year: r.year ?? undefined,
      description: r.description ?? undefined,
      genres: r.genres,
      rating: r.rating ?? undefined,
    }));
    trendingCacheSet(cacheKey, { data: metas, expiry: now + TRENDING_CACHE_TTL_MS });
    return { metas: applyRpdbToMetaList(metas, rpdbKey) };
  } catch (error) {
    request.log.error(error, "Popular fetch failed");
    return reply.code(500).send({ error: "Failed to fetch popular content" });
  }
});

// ─── User Ratings ───

app.post<{ Body: unknown }>("/ratings", async (request, reply) => {
  const body = request.body as { imdbId?: unknown; type?: unknown; rating?: unknown } | null;
  if (!body) return reply.code(400).send({ error: "Body is required" });

  const imdbId = typeof body.imdbId === "string" ? body.imdbId.trim() : "";
  if (!imdbId) return reply.code(400).send({ error: "imdbId is required" });

  const rawType = typeof body.type === "string" ? body.type : "";
  if (rawType !== "movie" && rawType !== "series") {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  const rating = typeof body.rating === "number" && Number.isFinite(body.rating) ? body.rating : null;
  if (rating === null || rating < 1 || rating > 10) {
    return reply.code(400).send({ error: "rating must be a number between 1 and 10" });
  }

  const roundedRating = Math.round(rating * 10) / 10;

  const row = await prisma.kV.upsert({
    where: { key: `rating:${rawType}:${imdbId}` },
    create: {
      key: `rating:${rawType}:${imdbId}`,
      value: JSON.stringify({ imdbId, type: rawType, rating: roundedRating, ratedAt: new Date().toISOString() }),
      updatedAt: new Date(),
    },
    update: {
      value: JSON.stringify({ imdbId, type: rawType, rating: roundedRating, ratedAt: new Date().toISOString() }),
      updatedAt: new Date(),
    },
  });

  const parsed = JSON.parse(row.value);
  return reply.code(200).send({ rating: parsed });
});

app.delete<{ Params: { type: string; imdbId: string } }>("/ratings/:type/:imdbId", async (request, reply) => {
  const { type, imdbId } = request.params;
  if (type !== "movie" && type !== "series") {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  try {
    await prisma.kV.delete({ where: { key: `rating:${type}:${imdbId}` } });
  } catch {
    // not found is fine
  }
  return reply.code(204).send();
});

app.get<{ Params: { type: string; imdbId: string } }>("/ratings/:type/:imdbId", async (request, reply) => {
  const { type, imdbId } = request.params;
  if (type !== "movie" && type !== "series") {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  const row = await prisma.kV.findUnique({ where: { key: `rating:${type}:${imdbId}` } });
  if (!row) return reply.code(404).send({ error: "No rating found" });

  return { rating: JSON.parse(row.value) };
});

app.get<{ Querystring: { type?: string; limit?: string } }>("/ratings", async (request) => {
  const typeFilter = request.query.type;
  const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);

  const prefix = typeFilter ? `rating:${typeFilter}:` : "rating:";
  const rows = await prisma.kV.findMany({
    where: { key: { startsWith: prefix } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  const ratings = rows.map((r) => JSON.parse(r.value));
  return { ratings };
});

// ─── Recommendations (TMDB) ───

app.get<{ Querystring: { imdbId?: string; type?: string } }>("/recommendations", async (request, reply) => {
  const imdbId = request.query.imdbId?.trim();
  const rawType = request.query.type ?? "movie";
  const type = getMetadataType(rawType);
  if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });
  if (!imdbId) return reply.code(400).send({ error: "imdbId is required" });

  const cacheKey = `recs:${rawType}:${imdbId}`;
  const now = Date.now();
  const [cached, rpdbKeyRec] = await Promise.all([Promise.resolve(trendingCacheGet(cacheKey)), getRpdbApiKey()]);
  if (cached && now < cached.expiry) return { metas: applyRpdbToMetaList(cached.data, rpdbKeyRec) };

  // Look up tmdbId from metadata
  const meta = await prisma.metadata.findUnique({
    where: { imdbId_type: { imdbId, type } },
    select: { tmdbId: true },
  });

  if (!meta?.tmdbId) {
    // Try to fetch metadata first
    try {
      const fetched = await fetchMetadata(type, imdbId);
      if (!fetched?.tmdbId) return { metas: [] };
      return await getRecommendations(rawType, type, fetched.tmdbId, cacheKey, now);
    } catch {
      return { metas: [] };
    }
  }

  return await getRecommendations(rawType, type, meta.tmdbId, cacheKey, now);
});

async function getRecommendations(rawType: string, type: MetadataType, tmdbId: number, cacheKey: string, now: number) {
  try {
    const tmdb = await getTmdb();
    const results = await tmdb.recommendations(type, tmdbId);
    await Promise.all(results.map((r) => upsertMetadata(r)));
    const metas: StremioMetaPreview[] = results.map((r) => ({
      id: r.imdbId,
      type: rawType as StremioMetaType,
      name: r.name,
      poster: r.poster ?? undefined,
      year: r.year ?? undefined,
      description: r.description ?? undefined,
      genres: r.genres,
      rating: r.rating ?? undefined,
    }));
    trendingCacheSet(cacheKey, { data: metas, expiry: now + TRENDING_CACHE_TTL_MS });
    const rpdbKey = await getRpdbApiKey();
    return { metas: applyRpdbToMetaList(metas, rpdbKey) };
  } catch {
    return { metas: [] };
  }
}

// Personalized recommendations based on recently watched
app.get<{ Querystring: { type?: string; limit?: string } }>("/recommendations/personal", async (request) => {
  const rawType = request.query.type ?? "movie";
  const type = getMetadataType(rawType);
  if (!type) return { metas: [] };
  const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 40);

  // AI takes over when configured
  if (await isAiConfigured()) {
    const aiResult = await getAiRecommendations(rawType as "movie" | "series", limit);
    if (aiResult) return { metas: aiResult.metas };
    // Fall through to TMDB if AI fails
  }

  // Get recently watched items of this type
  const recentItems = rawType === "movie"
    ? await prisma.watchEvent.findMany({
        where: { type: "movie" },
        orderBy: { watchedAt: "desc" },
        take: 5,
        distinct: ["imdbId"],
        select: { imdbId: true },
      })
    : await prisma.seriesProgress.findMany({
        orderBy: { lastWatchedAt: "desc" },
        take: 5,
        select: { seriesImdbId: true },
      });

  const seedImdbIds = rawType === "movie"
    ? recentItems.map((r) => (r as { imdbId: string }).imdbId)
    : recentItems.map((r) => (r as { seriesImdbId: string }).seriesImdbId);

  if (seedImdbIds.length === 0) return { metas: [] };

  // Look up tmdbIds for seeds
  const metas = await prisma.metadata.findMany({
    where: { imdbId: { in: seedImdbIds }, type },
    select: { tmdbId: true, imdbId: true },
  });

  const tmdbIds = metas.filter((m) => m.tmdbId !== null).map((m) => m.tmdbId as number);
  if (tmdbIds.length === 0) return { metas: [] };

  // Fetch recommendations from each seed, deduplicate, with per-seed cache
  let tmdb: TmdbClient;
  try {
    tmdb = await getTmdb();
  } catch {
    return { metas: [] };
  }
  const seen = new Set<string>(seedImdbIds); // exclude items user already watched
  const allRecs: StremioMetaPreview[] = [];

  for (const tmdbId of tmdbIds.slice(0, 3)) {
    if (allRecs.length >= limit) break;
    try {
      // Check per-seed cache first
      const seedCacheKey = `recs:seed:${rawType}:${tmdbId}`;
      const cachedSeed = trendingCacheGet(seedCacheKey);
      let recs: MetadataPayload[];
      if (cachedSeed && Date.now() < cachedSeed.expiry) {
        // Reconstruct payloads from cached metas
        recs = (cachedSeed.data as StremioMetaPreview[]).map((m) => ({
          imdbId: m.id,
          type,
          tmdbId: null,
          name: m.name,
          year: m.year ?? null,
          poster: m.poster ?? null,
          background: null,
          description: m.description ?? null,
          genres: m.genres ?? [],
          rating: m.rating ?? null,
          voteCount: null,
          totalSeasons: null,
          totalEpisodes: null,
          runtime: null,
          certification: null,
          status: null,
          network: null,
          releaseDate: null,
        }));
      } else {
        recs = await tmdb.recommendations(type, tmdbId);
        // Cache the raw results for this seed
        const seedMetas: StremioMetaPreview[] = recs.map((r) => ({
          id: r.imdbId,
          type: rawType as StremioMetaType,
          name: r.name,
          poster: r.poster ?? undefined,
          year: r.year ?? undefined,
          description: r.description ?? undefined,
          genres: r.genres,
          rating: r.rating ?? undefined,
        }));
        trendingCacheSet(seedCacheKey, { data: seedMetas, expiry: Date.now() + TRENDING_CACHE_TTL_MS });
      }
      for (const r of recs) {
        if (allRecs.length >= limit) break;
        if (seen.has(r.imdbId)) continue;
        seen.add(r.imdbId);
        allRecs.push({
          id: r.imdbId,
          type: rawType as StremioMetaType,
          name: r.name,
          poster: r.poster ?? undefined,
          year: r.year ?? undefined,
          description: r.description ?? undefined,
          genres: r.genres,
          rating: r.rating ?? undefined,
        });
        if (r.tmdbId !== null) void upsertMetadata(r);
      }
    } catch {
      // skip failed seeds
    }
  }

  const rpdbKeyPersonal = await getRpdbApiKey();
  return { metas: applyRpdbToMetaList(allRecs.slice(0, limit), rpdbKeyPersonal) };
});

// AI-powered recommendations endpoint
app.get<{ Querystring: { type?: string; limit?: string } }>("/recommendations/ai", async (request) => {
  const rawType = request.query.type ?? "movie";
  if (rawType !== "movie" && rawType !== "series") return { metas: [], reasons: {} };
  const type = rawType as "movie" | "series";
  const limit = Math.min(Math.max(Number(request.query.limit) || 10, 1), 20);

  if (!await isAiConfigured()) {
    // Fall back to personal recommendations when AI not configured
    const recentItems = type === "movie"
      ? await prisma.watchEvent.findMany({ where: { type: "movie" }, orderBy: { watchedAt: "desc" }, take: 3, distinct: ["imdbId"], select: { imdbId: true } })
      : await prisma.seriesProgress.findMany({ orderBy: { lastWatchedAt: "desc" }, take: 3, select: { seriesImdbId: true } });
    const seedIds = type === "movie"
      ? (recentItems as { imdbId: string }[]).map((r) => r.imdbId)
      : (recentItems as { seriesImdbId: string }[]).map((r) => r.seriesImdbId);
    if (seedIds.length === 0) return { metas: [], reasons: {} };
    const metaType = type === "movie" ? MetadataType.movie : MetadataType.series;
    const seedMetas = await prisma.metadata.findMany({ where: { imdbId: { in: seedIds }, type: metaType }, select: { tmdbId: true } });
    const tmdbIds = seedMetas.filter((m) => m.tmdbId).map((m) => m.tmdbId as number);
    if (tmdbIds.length === 0) return { metas: [], reasons: {} };
    try {
      const tmdb = await getTmdb();
      const seen = new Set<string>(seedIds);
      const allRecs: StremioMetaPreview[] = [];
      for (const tmdbId of tmdbIds.slice(0, 3)) {
        if (allRecs.length >= limit) break;
        const recs = await tmdb.recommendations(metaType, tmdbId);
        for (const r of recs) {
          if (allRecs.length >= limit) break;
          if (seen.has(r.imdbId)) continue;
          seen.add(r.imdbId);
          allRecs.push({ id: r.imdbId, type, name: r.name, poster: r.poster ?? undefined, year: r.year ?? undefined, description: r.description ?? undefined, genres: r.genres, rating: r.rating ?? undefined });
        }
      }
      const rpdbKey = await getRpdbApiKey();
      return { metas: applyRpdbToMetaList(allRecs.slice(0, limit), rpdbKey), reasons: {} };
    } catch { return { metas: [], reasons: {} }; }
  }

  const result = await getAiRecommendations(type, limit);
  if (!result) {
    // AI failed — fall back silently, return empty reasons
    return { metas: [], reasons: {} };
  }
  return { metas: result.metas, reasons: result.reasons };
});

// Manual AI recommendation refresh
app.post("/recommendations/ai/refresh", async () => {
  for (const key of ["ai-recs:movie", "ai-recs:series"]) {
    trendingCache.delete(key);
  }
  return { refreshed: true };
});

// ─── AI Recommendations Engine ───

const buildTasteProfile = async () => {
  // Top 50 most recent watch events distinct by imdbId
  const recentEvents = await prisma.watchEvent.findMany({
    orderBy: { watchedAt: "desc" },
    take: 50,
    distinct: ["imdbId"],
    select: { imdbId: true, type: true, seriesImdbId: true },
  });

  const movieIds = recentEvents.filter((e) => e.type === "movie").map((e) => e.imdbId);
  const seriesIds = recentEvents
    .filter((e) => e.type === "episode" && e.seriesImdbId)
    .map((e) => e.seriesImdbId!)
    .filter(Boolean);
  const allIds = [...new Set([...movieIds, ...seriesIds])];

  const allMetadata = allIds.length > 0
    ? await prisma.metadata.findMany({
        where: { imdbId: { in: allIds } },
        select: { imdbId: true, name: true, genres: true },
      })
    : [];

  const metaByImdbId = new Map(allMetadata.map((m) => [m.imdbId, m]));

  // Fetch ratings
  const ratingRows = await prisma.kV.findMany({
    where: { key: { startsWith: "rating:" } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const ratings: Array<{ imdbId: string; rating: number }> = [];
  for (const row of ratingRows) {
    try {
      const parsed = JSON.parse(row.value) as { imdbId?: string; rating?: number };
      if (parsed.imdbId && typeof parsed.rating === "number") {
        ratings.push({ imdbId: parsed.imdbId, rating: parsed.rating });
      }
    } catch { /* skip */ }
  }

  // Top genres by frequency
  const genreFreq = new Map<string, number>();
  for (const id of allIds) {
    const meta = metaByImdbId.get(id);
    if (meta) {
      for (const g of meta.genres) {
        genreFreq.set(g, (genreFreq.get(g) ?? 0) + 1);
      }
    }
  }
  const topGenres = [...genreFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g);

  // Top rated (>= 8) with names
  const topRated = ratings
    .filter((r) => r.rating >= 8)
    .map((r) => {
      const meta = metaByImdbId.get(r.imdbId);
      return meta ? `${meta.name} (${r.rating}/10)` : null;
    })
    .filter((s): s is string => s !== null)
    .slice(0, 15);

  // Recent titles (last 20)
  const recentTitles = recentEvents
    .slice(0, 20)
    .map((e) => {
      const id = e.type === "episode" && e.seriesImdbId ? e.seriesImdbId : e.imdbId;
      return metaByImdbId.get(id)?.name;
    })
    .filter((n): n is string => !!n);

  const watchedImdbIds = new Set(allIds);

  const avgRating = ratings.length > 0
    ? Math.round((ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length) * 10) / 10
    : null;

  return { topGenres, topRated, recentTitles, watchedImdbIds, avgRating };
};

const callAiProvider = async (config: AiProviderConfig, prompt: string): Promise<string> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  const payload = {
    ...config.payload,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    max_tokens: (config.payload.max_tokens as number | undefined) ?? 4096,
  };

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`AI provider error (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  let content = data.choices?.[0]?.message?.content ?? "";

  // Strip thinking blocks and markdown fences
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  return content;
};

type AiRecItem = { title: string; year?: number; type: "movie" | "series"; reason: string };

const parseRecsFromContent = (content: string): AiRecItem[] => {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array in AI response");
  return JSON.parse(match[0]) as AiRecItem[];
};

const AI_RECS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const getAiRecommendations = async (
  type: "movie" | "series",
  limit = 10
): Promise<{ metas: StremioMetaPreview[]; reasons: Record<string, string> } | null> => {
  const cacheKey = `ai-recs:${type}`;
  const cached = trendingCacheGet(cacheKey);
  if (cached) return { metas: cached.data, reasons: cached.reasons ?? {} };

  const config = await getAiConfig();
  if (!config) return null;

  try {
    const profile = await buildTasteProfile();
    const avgRatingStr = profile.avgRating !== null ? `${profile.avgRating}/10` : "unrated";
    const typeLabel = type === "movie" ? "movies" : "TV series";

    const prompt = `You are a ${type} recommendation engine with deep knowledge of film and television.

User taste profile:
- Top genres: ${profile.topGenres.join(", ") || "unknown"}
- Highly rated: ${profile.topRated.join(", ") || "none yet"}
- Recently watched: ${profile.recentTitles.join(", ") || "nothing yet"}
- Average rating they give: ${avgRatingStr}

Recommend exactly ${limit} ${typeLabel} this user has NOT already watched. Be specific and varied.

Return ONLY a JSON array, no other text, no markdown:
[
  {
    "title": "exact title",
    "year": release year as number,
    "type": "${type}",
    "reason": "one sentence why based on their taste"
  }
]`;

    const content = await callAiProvider(config, prompt);
    const recs = parseRecsFromContent(content);

    const tmdb = await getTmdb();
    const metaType = type === "movie" ? MetadataType.movie : MetadataType.series;
    const rpdbKey = await getRpdbApiKey();
    const metas: StremioMetaPreview[] = [];
    const reasons: Record<string, string> = {};

    for (const rec of recs) {
      if (metas.length >= limit) break;
      try {
        const results = await tmdb.search(metaType, rec.title);
        if (!results || results.length === 0) continue;
        const first = results[0];
        if (profile.watchedImdbIds.has(first.imdbId)) continue;
        await upsertMetadata(first);
        metas.push({
          id: first.imdbId,
          type,
          name: first.name,
          poster: withRpdbPoster(first.imdbId, first.poster, rpdbKey) ?? undefined,
          year: first.year ?? undefined,
          description: first.description ?? undefined,
          genres: first.genres,
          rating: first.rating ?? undefined,
        });
        reasons[first.imdbId] = rec.reason;
      } catch { /* skip failed lookups */ }
    }

    trendingCacheSet(cacheKey, { data: metas, expiry: Date.now() + AI_RECS_TTL_MS, reasons });

    const now = new Date();
    await prisma.kV.upsert({
      where: { key: AI_LAST_RECS_GENERATED_AT_KEY },
      create: { key: AI_LAST_RECS_GENERATED_AT_KEY, value: now.toISOString(), updatedAt: now },
      update: { value: now.toISOString(), updatedAt: now },
    });

    return { metas, reasons };
  } catch (err) {
    app.log.error(err, "AI recommendations generation failed");
    return null;
  }
};

const shouldRefreshAiRecs = async (): Promise<boolean> => {
  if (!await isAiConfigured()) return false;

  const lastGenRow = await prisma.kV.findUnique({ where: { key: AI_LAST_RECS_GENERATED_AT_KEY } });
  if (!lastGenRow) return true;

  const lastGen = new Date(lastGenRow.value);
  const hoursSinceLastGen = (Date.now() - lastGen.getTime()) / (1000 * 60 * 60);
  return hoursSinceLastGen >= 6;
};

// ─── Plex / Jellyfin Webhooks ───

// ─── Shared watch event recording helper ───

type RecordWatchParams = {
  type: "episode" | "movie";
  imdbId: string;
  seriesImdbId?: string;
  season?: number | null;
  episode?: number | null;
  watchedAt: Date;
  source: string;
  request: FastifyRequest;
};

const recordWatchEvent = async (params: RecordWatchParams) => {
  const { type, imdbId, seriesImdbId, season, episode, watchedAt, source, request: req } = params;

  // Same-day dedupe: if an event for the same key exists on the same UTC day, increment plays
  const dayStart = new Date(watchedAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(watchedAt);
  dayEnd.setUTCHours(23, 59, 59, 999);

  if (type === "episode") {
    const resolvedSeriesImdbId = seriesImdbId ?? imdbId;

    const watchEvent = await prisma.$transaction(async (tx) => {
      const existing = await tx.watchEvent.findFirst({
        where: { seriesImdbId: resolvedSeriesImdbId, season: season ?? null, episode: episode ?? null, watchedAt: { gte: dayStart, lte: dayEnd } },
      });

      if (existing) {
        const updated = await tx.watchEvent.update({
          where: { id: existing.id },
          data: { plays: existing.plays + 1, watchedAt },
        });
        req.log.info({ imdbId: resolvedSeriesImdbId, season, episode, plays: updated.plays }, `${source} scrobble: episode play incremented`);
        return updated;
      }

      const created = await tx.watchEvent.create({
        data: { type: "episode", imdbId: resolvedSeriesImdbId, seriesImdbId: resolvedSeriesImdbId, season: season ?? null, episode: episode ?? null, watchedAt },
      });
      req.log.info({ imdbId: resolvedSeriesImdbId, season, episode }, `${source} scrobble: episode recorded`);
      return created;
    });

    if (season != null && episode != null) {
      await upsertSeriesProgressIfNewer(resolvedSeriesImdbId, { lastSeason: season, lastEpisode: episode, lastWatchedAt: watchedAt });
    }
    void (async () => {
      try {
        if (await shouldRefreshAiRecs()) {
          trendingCache.delete("ai-recs:movie");
          trendingCache.delete("ai-recs:series");
          await Promise.allSettled([getAiRecommendations("movie", 15), getAiRecommendations("series", 15)]);
        }
      } catch { /* never let this affect the watch event response */ }
    })();
    return { status: "recorded" as const, watchEvent };
  }

  // Movie
  const watchEvent = await prisma.$transaction(async (tx) => {
    const existing = await tx.watchEvent.findFirst({
      where: { imdbId, type: "movie", watchedAt: { gte: dayStart, lte: dayEnd } },
    });

    if (existing) {
      const updated = await tx.watchEvent.update({
        where: { id: existing.id },
        data: { plays: existing.plays + 1, watchedAt },
      });
      req.log.info({ imdbId, plays: updated.plays }, `${source} scrobble: movie play incremented`);
      return updated;
    }

    const created = await tx.watchEvent.create({
      data: { type: "movie", imdbId, watchedAt },
    });
    req.log.info({ imdbId }, `${source} scrobble: movie recorded`);
    return created;
  });

  void (async () => {
    try {
      if (await shouldRefreshAiRecs()) {
        trendingCache.delete("ai-recs:movie");
        trendingCache.delete("ai-recs:series");
        await Promise.allSettled([getAiRecommendations("movie", 15), getAiRecommendations("series", 15)]);
      }
    } catch { /* never let this affect the watch event response */ }
  })();
  return { status: "recorded" as const, watchEvent };
};

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET?.trim();

const verifyWebhookSecret = (request: FastifyRequest): boolean => {
  if (!WEBHOOK_SECRET) return true; // no secret configured = accept all
  const provided = (request.query as Record<string, string>).token
    ?? request.headers["x-webhook-secret"] as string | undefined;
  return provided === WEBHOOK_SECRET;
};

// Register content type parser for multipart (Plex sends multipart/form-data)
app.addContentTypeParser("multipart/form-data", { parseAs: "string" }, (_request, body, done) => {
  done(null, body);
});

/**
 * Extract the "payload" field value from a multipart/form-data body string.
 * Returns the JSON string or null if not found.
 */
function extractMultipartPayload(rawBody: string, contentType: string): string | null {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) return null;

  const parts = rawBody.split(`--${boundary}`);
  for (const part of parts) {
    // Match the Content-Disposition header for the "payload" field
    if (!/name="payload"/i.test(part)) continue;

    // The body starts after the first blank line (header/body separator)
    const headerEnd = part.indexOf("\r\n\r\n");
    const altHeaderEnd = part.indexOf("\n\n");
    const bodyStart = headerEnd !== -1 ? headerEnd + 4 : altHeaderEnd !== -1 ? altHeaderEnd + 2 : -1;
    if (bodyStart === -1) continue;

    const body = part.slice(bodyStart).trim();
    // Validate it looks like JSON before returning
    if (body.startsWith("{") && body.endsWith("}")) {
      return body;
    }
  }
  return null;
}

app.post("/webhooks/plex", async (request, reply) => {
  if (!verifyWebhookSecret(request)) {
    return reply.code(403).send({ error: "Invalid webhook secret" });
  }

  let payloadStr: string | null = null;

  // Plex sends multipart/form-data with a "payload" field
  const rawBody = request.body;
  if (typeof rawBody === "string") {
    payloadStr = extractMultipartPayload(rawBody, request.headers["content-type"] ?? "");
  } else if (rawBody && typeof rawBody === "object") {
    // Fallback: might arrive as parsed JSON
    payloadStr = JSON.stringify(rawBody);
  }

  if (!payloadStr) {
    return reply.code(400).send({ error: "No payload found. Expected multipart/form-data with a 'payload' field." });
  }

  let payload: {
    event?: string;
    Metadata?: {
      type?: string;
      title?: string;
      grandparentTitle?: string;
      parentIndex?: number;
      index?: number;
      Guid?: Array<{ id?: string }>;
      guid?: string;
    };
  };

  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return reply.code(400).send({ error: "Invalid JSON payload" });
  }

  // Only process "media.scrobble" events (playback completed)
  const event = payload.event;
  if (event !== "media.scrobble") {
    request.log.info({ event }, "Plex webhook ignored (not a scrobble event)");
    return reply.code(200).send({ status: "ignored", event });
  }

  const metadata = payload.Metadata;
  if (!metadata) {
    return reply.code(400).send({ error: "No Metadata in payload" });
  }

  // Extract IMDb ID from Guid array
  let imdbId: string | null = null;
  for (const guid of metadata.Guid ?? []) {
    const match = guid.id?.match(/imdb:\/\/(tt\d+)/);
    if (match) { imdbId = match[1]; break; }
  }
  // Fallback: check top-level guid
  if (!imdbId && metadata.guid) {
    const match = metadata.guid.match(/imdb:\/\/(tt\d+)/);
    if (match) imdbId = match[1];
  }

  if (!imdbId) {
    request.log.warn({ metadata }, "Plex webhook: no IMDb ID found");
    return reply.code(200).send({ status: "skipped", reason: "no_imdb_id" });
  }

  const now = new Date();

  if (metadata.type === "episode") {
    const season = metadata.parentIndex ?? null;
    const episode = metadata.index ?? null;
    const result = await recordWatchEvent({ type: "episode", imdbId, seriesImdbId: imdbId, season, episode, watchedAt: now, source: "Plex", request });
    return reply.code(201).send(result);
  }

  const result = await recordWatchEvent({ type: "movie", imdbId, watchedAt: now, source: "Plex", request });
  return reply.code(201).send(result);
});

app.post("/webhooks/jellyfin", async (request, reply) => {
  if (!verifyWebhookSecret(request)) {
    return reply.code(403).send({ error: "Invalid webhook secret" });
  }

  const body = request.body as {
    NotificationType?: string;
    ItemType?: string;
    Name?: string;
    SeriesName?: string;
    Season?: number;
    Episode?: number;
    Provider_imdb?: string;
    SeriesId?: string;
  } | null;

  if (!body) {
    return reply.code(400).send({ error: "Empty body" });
  }

  // Only process PlaybackStop events (finished watching)
  if (body.NotificationType !== "PlaybackStop") {
    request.log.info({ type: body.NotificationType }, "Jellyfin webhook ignored");
    return reply.code(200).send({ status: "ignored", type: body.NotificationType });
  }

  const imdbId = body.Provider_imdb?.trim();
  if (!imdbId) {
    request.log.warn({ body }, "Jellyfin webhook: no IMDb ID");
    return reply.code(200).send({ status: "skipped", reason: "no_imdb_id" });
  }

  const now = new Date();

  if (body.ItemType === "Episode") {
    const season = typeof body.Season === "number" ? body.Season : null;
    const episode = typeof body.Episode === "number" ? body.Episode : null;
    const result = await recordWatchEvent({ type: "episode", imdbId, seriesImdbId: imdbId, season, episode, watchedAt: now, source: "Jellyfin", request });
    return reply.code(201).send(result);
  }

  const result = await recordWatchEvent({ type: "movie", imdbId, watchedAt: now, source: "Jellyfin", request });
  return reply.code(201).send(result);
});

// ─── Calendar / Upcoming Episodes ───

type CalendarEntry = {
  seriesImdbId: string;
  seriesName: string;
  poster: string | null;
  season: number;
  episode: number;
  episodeName: string;
  airDate: string;
  overview: string | null;
};

app.get<{ Querystring: { days?: string } }>("/calendar", async (request) => {
  const daysAhead = Math.min(Math.max(Number(request.query.days) || 30, 1), 90);

  // Get all series the user is watching
  const progressRows = await prisma.seriesProgress.findMany({
    orderBy: { lastWatchedAt: "desc" },
    take: 30, // limit to avoid too many TMDB calls
  });

  if (progressRows.length === 0) return { calendar: [] };

  const seriesImdbIds = progressRows.map((p) => p.seriesImdbId);
  const metadata = await prisma.metadata.findMany({
    where: { imdbId: { in: seriesImdbIds }, type: "series" },
    select: { imdbId: true, tmdbId: true, name: true, poster: true },
  });

  const metaByImdbId = new Map(metadata.map((m) => [m.imdbId, m]));

  let tmdb: TmdbClient;
  try {
    tmdb = await getTmdb();
  } catch {
    return { calendar: [] };
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + daysAhead);

  const calendar: CalendarEntry[] = [];

  // Fetch upcoming episodes for each series (in parallel, batched)
  const batchSize = 5;
  for (let i = 0; i < seriesImdbIds.length; i += batchSize) {
    const batch = seriesImdbIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (imdbId) => {
        const meta = metaByImdbId.get(imdbId);
        if (!meta?.tmdbId) return [];

        const details = await tmdb.getShowDetails(meta.tmdbId);
        if (!details) return [];

        const entries: CalendarEntry[] = [];

        if (details.nextEpisodeToAir) {
          const ep = details.nextEpisodeToAir;
          const airDate = new Date(ep.air_date);
          if (airDate >= today && airDate <= futureDate) {
            entries.push({
              seriesImdbId: imdbId,
              seriesName: meta.name,
              poster: meta.poster,
              season: ep.season_number,
              episode: ep.episode_number,
              episodeName: ep.name,
              airDate: ep.air_date,
              overview: ep.overview ?? null,
            });
          }
        }

        return entries;
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        calendar.push(...result.value);
      }
    }
  }

  // Sort by air date
  calendar.sort((a, b) => a.airDate.localeCompare(b.airDate));

  return { calendar };
});

// ─── Streaming Service Catalogs ───

app.get<{ Querystring: { type?: string; provider?: string; region?: string } }>("/streaming", async (request, reply) => {
  const rawType = request.query.type ?? "movie";
  const type = getMetadataType(rawType);
  if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });

  const providerKey = request.query.provider?.toLowerCase();
  if (!providerKey || !STREAMING_PROVIDERS[providerKey]) {
    return reply.code(400).send({
      error: "provider is required",
      available: Object.entries(STREAMING_PROVIDERS).map(([key, val]) => ({ key, ...val })),
    });
  }

  const region = request.query.region ?? await getRegionSetting();
  const provider = STREAMING_PROVIDERS[providerKey];
  const cacheKey = `streaming:${providerKey}:${rawType}:${region}`;
  const now = Date.now();
  const [cached, rpdbKeyStream] = await Promise.all([Promise.resolve(trendingCacheGet(cacheKey)), getRpdbApiKey()]);
  if (cached && now < cached.expiry) return { metas: applyRpdbToMetaList(cached.data, rpdbKeyStream), provider: provider.name };

  try {
    const tmdb = await getTmdb();
    const results = await tmdb.discoverByProvider(type, provider.id, region);
    await Promise.all(results.map((r) => upsertMetadata(r)));
    const metas: StremioMetaPreview[] = results.map((r) => ({
      id: r.imdbId,
      type: rawType as StremioMetaType,
      name: r.name,
      poster: r.poster ?? undefined,
      year: r.year ?? undefined,
      description: r.description ?? undefined,
      genres: r.genres,
      rating: r.rating ?? undefined,
    }));
    trendingCacheSet(cacheKey, { data: metas, expiry: now + TRENDING_CACHE_TTL_MS });
    return { metas: applyRpdbToMetaList(metas, rpdbKeyStream), provider: provider.name };
  } catch (error) {
    request.log.error(error, "Streaming catalog fetch failed");
    return reply.code(500).send({ error: "Failed to fetch streaming catalog" });
  }
});

app.get("/streaming/providers", async () => {
  return {
    providers: Object.entries(STREAMING_PROVIDERS).map(([key, val]) => ({ key, ...val })),
  };
});

// ─── Anime Catalog ───

app.get<{ Querystring: { type?: string } }>("/anime", async (request, reply) => {
  const rawType = request.query.type ?? "series";
  const type = getMetadataType(rawType);
  if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });

  const cacheKey = `anime:${rawType}`;
  const now = Date.now();
  const [cached, rpdbKeyAnime] = await Promise.all([Promise.resolve(trendingCacheGet(cacheKey)), getRpdbApiKey()]);
  if (cached && now < cached.expiry) return { metas: applyRpdbToMetaList(cached.data, rpdbKeyAnime) };

  try {
    const tmdb = await getTmdb();
    const results = await tmdb.discoverAnime(type);
    await Promise.all(results.map((r) => upsertMetadata(r)));
    const metas: StremioMetaPreview[] = results.map((r) => ({
      id: r.imdbId,
      type: rawType as StremioMetaType,
      name: r.name,
      poster: r.poster ?? undefined,
      year: r.year ?? undefined,
      description: r.description ?? undefined,
      genres: r.genres,
      rating: r.rating ?? undefined,
    }));
    trendingCacheSet(cacheKey, { data: metas, expiry: now + TRENDING_CACHE_TTL_MS });
    return { metas: applyRpdbToMetaList(metas, rpdbKeyAnime) };
  } catch (error) {
    request.log.error(error, "Anime catalog fetch failed");
    return reply.code(500).send({ error: "Failed to fetch anime catalog" });
  }
});

// ─── Settings (Language, Region, Spoiler Protection) ───

app.get("/settings/preferences", async () => {
  const [language, region, spoilerProtection] = await Promise.all([
    getLanguageSetting(),
    getRegionSetting(),
    getSpoilerProtection(),
  ]);
  return {
    language,
    region,
    spoilerProtection,
    availableProviders: Object.entries(STREAMING_PROVIDERS).map(([key, val]) => ({ key, ...val })),
  };
});

app.post<{ Body: unknown }>("/settings/preferences", async (request, reply) => {
  const body = request.body as { language?: unknown; region?: unknown; spoilerProtection?: unknown } | null;
  if (!body) return reply.code(400).send({ error: "Body is required" });

  // Validate patterns: language = "xx" or "xx-YY", region = two uppercase letters
  const LANGUAGE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
  const REGION_PATTERN = /^[A-Z]{2}$/;

  const now = new Date();

  if (typeof body.language === "string" && body.language.trim()) {
    const raw = body.language.trim();
    // Normalize casing: language subtag lowercase, region subtag uppercase (e.g., "en-US")
    const parts = raw.split("-");
    const normalizedLang = parts.length === 2
      ? `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`
      : parts[0].toLowerCase();
    if (!LANGUAGE_PATTERN.test(normalizedLang)) {
      return reply.code(400).send({ error: "language must be a valid language code (e.g., 'en-US', 'fr')" });
    }
    await prisma.kV.upsert({
      where: { key: LANGUAGE_KV_KEY },
      create: { key: LANGUAGE_KV_KEY, value: normalizedLang, updatedAt: now },
      update: { value: normalizedLang, updatedAt: now },
    });
  }

  if (typeof body.region === "string" && body.region.trim()) {
    const reg = body.region.trim().toUpperCase();
    if (!REGION_PATTERN.test(reg)) {
      return reply.code(400).send({ error: "region must be a valid two-letter country code (e.g., 'US', 'GB')" });
    }
    await prisma.kV.upsert({
      where: { key: REGION_KV_KEY },
      create: { key: REGION_KV_KEY, value: reg, updatedAt: now },
      update: { value: reg, updatedAt: now },
    });
  }

  if (typeof body.spoilerProtection === "boolean") {
    await prisma.kV.upsert({
      where: { key: SPOILER_PROTECTION_KV_KEY },
      create: { key: SPOILER_PROTECTION_KV_KEY, value: String(body.spoilerProtection), updatedAt: now },
      update: { value: String(body.spoilerProtection), updatedAt: now },
    });
  }

  // Clear metadata cache to pick up language changes
  trendingCache.clear();

  return await (async () => {
    const [language, region, spoilerProtection] = await Promise.all([
      getLanguageSetting(),
      getRegionSetting(),
      getSpoilerProtection(),
    ]);
    return { language, region, spoilerProtection };
  })();
});

app.get("/health", async () => ({ status: "ok", service: "api" }));

app.get("/genres", async () => {
  const rows = await prisma.metadata.findMany({
    where: { genres: { isEmpty: false } },
    select: { genres: true }
  });
  const genreSet = new Set<string>();
  for (const row of rows) {
    for (const g of row.genres) genreSet.add(g);
  }
  const genres = [...genreSet].sort();
  return { genres };
});

app.get("/users", async () => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  return { users };
});

app.post<{ Body: unknown }>("/users", async (request, reply) => {
  if (!request.body || typeof request.body !== "object") {
    return reply.code(400).send({ error: "email is required" });
  }

  const email = (request.body as { email?: unknown }).email;
  if (typeof email !== "string" || !email) {
    return reply.code(400).send({ error: "email is required" });
  }

  try {
    const user = await prisma.user.create({ data: { email } });
    return reply.code(201).send({ user });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return reply.code(409).send({ error: "Email already exists" });
    }

    throw error;
  }
});

app.post<{ Body: unknown }>("/lists", async (request, reply) => {
  if (!request.body || typeof request.body !== "object") {
    return reply.code(400).send({ error: "name and kind are required" });
  }

  const body = request.body as { name?: unknown; kind?: unknown };
  if (typeof body.name !== "string" || !body.name.trim()) {
    return reply.code(400).send({ error: "name and kind are required" });
  }

  if (!Object.values(ListKind).includes(body.kind as ListKind)) {
    return reply.code(400).send({ error: "kind must be one of: watchlist, custom" });
  }

  const list = await prisma.list.create({
    data: {
      name: body.name.trim(),
      kind: body.kind as ListKind
    }
  });

  return reply.code(201).send({ list: { ...list, itemCount: 0 } });
});

app.get("/lists", async () => {
  const lists = await prisma.list.findMany({
    orderBy: [{ createdAt: "asc" }],
    include: { _count: { select: { items: true } } }
  });

  return {
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      kind: list.kind,
      createdAt: list.createdAt,
      itemCount: list._count.items
    }))
  };
});

app.delete<{ Params: { id: string } }>("/lists/:id", async (request, reply) => {
  if (!UUID_V4_PATTERN.test(request.params.id)) {
    return reply.code(400).send({ error: "id must be a valid UUID" });
  }

  const list = await prisma.list.findUnique({ where: { id: request.params.id } });
  if (!list) {
    return reply.code(404).send({ error: "List not found" });
  }

  await prisma.listItem.deleteMany({ where: { listId: list.id } });
  await prisma.list.delete({ where: { id: list.id } });

  return reply.code(204).send();
});

app.patch<{ Params: { id: string }; Body: unknown }>("/lists/:id", async (request, reply) => {
  if (!UUID_V4_PATTERN.test(request.params.id)) {
    return reply.code(400).send({ error: "id must be a valid UUID" });
  }

  if (!request.body || typeof request.body !== "object") {
    return reply.code(400).send({ error: "name is required" });
  }

  const body = request.body as { name?: unknown };
  if (typeof body.name !== "string" || !body.name.trim()) {
    return reply.code(400).send({ error: "name is required" });
  }

  const list = await prisma.list.findUnique({ where: { id: request.params.id } });
  if (!list) {
    return reply.code(404).send({ error: "List not found" });
  }

  const updated = await prisma.list.update({
    where: { id: list.id },
    data: { name: body.name.trim() }
  });

  return { list: updated };
});

app.get<{ Querystring: { limit?: string } }>("/stremio/catalog/my_watchlist_movies", async (request) => {
  const limit = parseCatalogLimit(request.query.limit);
  const metas = await getWatchlistMetas("movie", limit);

  return { metas };
});

app.get<{ Querystring: { limit?: string } }>("/stremio/catalog/my_watchlist_series", async (request) => {
  const limit = parseCatalogLimit(request.query.limit);
  const metas = await getWatchlistMetas("series", limit);

  return { metas };
});

app.get<{ Querystring: { limit?: string } }>("/stremio/catalog/my_recent_movies", async (request) => {
  const limit = parseCatalogLimit(request.query.limit);
  const metas = await getRecentMetas("movie", limit);

  return { metas };
});

app.get<{ Querystring: { limit?: string } }>("/stremio/catalog/my_continue_series", async (request) => {
  const limit = parseCatalogLimit(request.query.limit);
  const metas = await getContinueMetas(limit);

  return { metas };
});

app.get<{ Params: { listId: string }; Querystring: { type?: string; limit?: string } }>("/stremio/list/:listId", async (request, reply) => {
  const type = parseMetaType(request.query.type);
  if (!type) {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  if (!UUID_V4_PATTERN.test(request.params.listId)) {
    return reply.code(400).send({ error: "listId must be a valid UUID" });
  }

  const list = await prisma.list.findUnique({
    where: { id: request.params.listId },
    select: { id: true, kind: true }
  });

  if (!list || list.kind !== ListKind.custom) {
    return reply.code(404).send({ error: "Custom list not found" });
  }

  const limit = parseCatalogLimit(request.query.limit);
  const metas = await getCustomListMetas(list.id, type, limit);

  return { metas };
});

app.get<{ Querystring: { type?: string; limit?: string } }>("/watchlist", async (request, reply) => {
  const type = parseMetaType(request.query.type);
  if (!type) {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  const limit = parseCatalogLimit(request.query.limit);
  const metas = await getWatchlistMetas(type, limit);

  return { metas };
});

app.get<{ Querystring: { limit?: string } }>("/continue", async (request) => {
  const limit = parseCatalogLimit(request.query.limit);
  const metas = await getContinueMetas(limit);

  return { metas };
});

app.get<{ Querystring: { type?: string; limit?: string } }>("/recent", async (request, reply) => {
  const type = parseMetaType(request.query.type);
  if (!type) {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  const limit = parseCatalogLimit(request.query.limit);
  const metas = await getRecentMetas(type, limit);

  return { metas };
});

app.post<{ Params: { listId: string }; Body: unknown }>("/lists/:listId/items", async (request, reply) => {
  if (!request.body || typeof request.body !== "object") {
    return reply.code(400).send({ error: "type and imdbId are required" });
  }

  const body = request.body as { type?: unknown; imdbId?: unknown; title?: unknown };
  if (!Object.values(ListItemType).includes(body.type as ListItemType)) {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  if (typeof body.imdbId !== "string" || !body.imdbId.trim()) {
    return reply.code(400).send({ error: "type and imdbId are required" });
  }

  if (body.title !== undefined && typeof body.title !== "string") {
    return reply.code(400).send({ error: "title must be a string when provided" });
  }

  if (!UUID_V4_PATTERN.test(request.params.listId)) {
    return reply.code(400).send({ error: "listId must be a valid UUID" });
  }

  const list = await prisma.list.findUnique({ where: { id: request.params.listId } });
  if (!list) {
    return reply.code(404).send({ error: "List not found" });
  }

  const imdbId = body.imdbId.trim();
  const type = body.type as ListItemType;

  if (!Object.values(ItemType).includes(type as ItemType)) {
    return reply.code(400).send({ error: "type must be a valid item type" });
  }

  const itemType = type as ItemType;

  try {
    const listItem = await prisma.$transaction(async (tx) => {
      await tx.item.upsert({
        where: { type_imdbId: { type: itemType, imdbId } },
        create: {
          type: itemType,
          imdbId,
          title: (body.title as string | undefined)?.trim() ? (body.title as string).trim() : undefined
        },
        update: (body.title as string | undefined)?.trim() ? { title: (body.title as string).trim() } : {}
      });

      return tx.listItem.create({
        data: {
          listId: request.params.listId,
          type,
          imdbId
        }
      });
    });

    // Trigger background metadata sync so posters/descriptions are available
    const metadataTypeForSync = itemType === ItemType.movie ? MetadataType.movie : MetadataType.series;
    void syncMetadata(imdbId, metadataTypeForSync).catch(() => {});

    return reply.code(201).send({ listItem });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return reply.code(409).send({ error: "Item already exists in this list" });
    }
    throw error;
  }
});

app.delete<{ Params: { listId: string; type: string; imdbId: string } }>("/lists/:listId/items/:type/:imdbId", async (request, reply) => {
  const type = request.params.type;
  if (!Object.values(ListItemType).includes(type as ListItemType)) {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  const removed = await prisma.listItem.deleteMany({
    where: {
      listId: request.params.listId,
      type: type as ListItemType,
      imdbId: request.params.imdbId
    }
  });

  if (removed.count === 0) {
    return reply.code(404).send({ error: "List item not found" });
  }

  return reply.code(204).send();
});

app.delete<{ Params: { listId: string; imdbId: string }; Querystring: { type?: string } }>("/lists/:listId/items/:imdbId", async (request, reply) => {
  if (!UUID_V4_PATTERN.test(request.params.listId)) {
    return reply.code(400).send({ error: "listId must be a valid UUID" });
  }

  const where: { listId: string; imdbId: string; type?: ListItemType } = {
    listId: request.params.listId,
    imdbId: request.params.imdbId
  };

  if (request.query.type) {
    if (!Object.values(ListItemType).includes(request.query.type as ListItemType)) {
      return reply.code(400).send({ error: "type must be one of: movie, series" });
    }
    where.type = request.query.type as ListItemType;
  } else {
    const count = await prisma.listItem.count({ where });
    if (count === 0) {
      return reply.code(404).send({ error: "List item not found" });
    }
    if (count > 1) {
      return reply.code(400).send({ error: "Multiple items match this imdbId; provide ?type=movie or ?type=series to disambiguate" });
    }
  }

  const removed = await prisma.listItem.deleteMany({ where });

  if (removed.count === 0) {
    return reply.code(404).send({ error: "List item not found" });
  }

  return reply.code(204).send();
});

app.get<{ Params: { listId: string } }>("/lists/:listId/items", async (request, reply) => {
  if (!UUID_V4_PATTERN.test(request.params.listId)) {
    return reply.code(400).send({ error: "listId must be a valid UUID" });
  }

  const list = await prisma.list.findUnique({ where: { id: request.params.listId } });
  if (!list) {
    return reply.code(404).send({ error: "List not found" });
  }

  const listItems = await prisma.listItem.findMany({
    where: { listId: request.params.listId },
    orderBy: { addedAt: "desc" }
  });

  const metadataMap = new Map<string, { name: string; poster: string | null; year: number | null; genres: string[]; rating: number | null }>();
  if (listItems.length > 0) {
    const metadata = await prisma.metadata.findMany({
      where: {
        OR: listItems.map((item) => ({
          imdbId: item.imdbId,
          type: item.type as unknown as MetadataType
        }))
      },
      select: { imdbId: true, type: true, name: true, poster: true, year: true, genres: true, rating: true }
    });

    for (const m of metadata) {
      metadataMap.set(`${m.imdbId}:${m.type}`, { name: m.name, poster: m.poster, year: m.year, genres: m.genres, rating: m.rating });
    }
  }

  const items = listItems.map((item) => {
    const meta = metadataMap.get(`${item.imdbId}:${item.type}`);
    return {
      ...item,
      metadata: meta ?? null
    };
  });

  return { items };
});

app.post<{ Body: unknown }>("/watch", async (request, reply) => {
  if (!request.body || typeof request.body !== "object") {
    return reply.code(400).send({ error: "type and imdbId are required" });
  }

  const body = request.body as {
    type?: unknown;
    imdbId?: unknown;
    seriesImdbId?: unknown;
    season?: unknown;
    episode?: unknown;
    watchedAt?: unknown;
  };

  if (!Object.values(WatchEventType).includes(body.type as WatchEventType)) {
    return reply.code(400).send({ error: "type must be one of: movie, episode" });
  }

  if (typeof body.imdbId !== "string" || !body.imdbId.trim()) {
    return reply.code(400).send({ error: "imdbId is required" });
  }

  if (body.seriesImdbId !== undefined && (typeof body.seriesImdbId !== "string" || !body.seriesImdbId.trim())) {
    return reply.code(400).send({ error: "seriesImdbId must be a non-empty string when provided" });
  }

  if (body.season !== undefined && (!Number.isInteger(body.season) || (body.season as number) < 0)) {
    return reply.code(400).send({ error: "season must be a non-negative integer when provided" });
  }

  if (body.episode !== undefined && (!Number.isInteger(body.episode) || (body.episode as number) < 0)) {
    return reply.code(400).send({ error: "episode must be a non-negative integer when provided" });
  }

  let watchedAt: Date;
  if (body.watchedAt !== undefined) {
    if (typeof body.watchedAt !== "string") {
      return reply.code(400).send({ error: "watchedAt must be an ISO 8601 string" });
    }
    watchedAt = new Date(body.watchedAt);
    if (Number.isNaN(watchedAt.getTime())) {
      return reply.code(400).send({ error: "watchedAt must be a valid ISO 8601 date" });
    }
  } else {
    watchedAt = new Date();
  }

  const type = body.type as WatchEventType;
  const imdbId = body.imdbId.trim();
  const seriesImdbId = body.seriesImdbId ? (body.seriesImdbId as string).trim() : null;
  const season = body.season as number | undefined ?? null;
  const episode = body.episode as number | undefined ?? null;

  const dayStart = new Date(watchedAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(watchedAt);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const existing = await prisma.watchEvent.findFirst({
    where: {
      imdbId,
      season,
      episode,
      watchedAt: { gte: dayStart, lte: dayEnd }
    }
  });

  if (existing) {
    const updated = await prisma.watchEvent.update({
      where: { id: existing.id },
      data: { plays: existing.plays + 1 }
    });
    return reply.code(200).send({ watchEvent: updated });
  }

  const watchEvent = await prisma.watchEvent.create({
    data: { type, imdbId, seriesImdbId, season, episode, watchedAt }
  });

  if (type === "episode" && seriesImdbId && season !== null && episode !== null) {
    await upsertSeriesProgressIfNewer(seriesImdbId, {
      lastSeason: season,
      lastEpisode: episode,
      lastWatchedAt: watchedAt
    });
  }

  return reply.code(201).send({ watchEvent });
});

app.get<{ Querystring: { limit?: string; offset?: string } }>("/watch/history", async (request) => {
  const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(request.query.offset) || 0, 0);

  const events = await prisma.watchEvent.findMany({
    orderBy: { watchedAt: "desc" },
    take: limit,
    skip: offset
  });

  if (events.length === 0) {
    return { history: [] };
  }

  const movieImdbIds = events.filter((e) => e.type === "movie").map((e) => e.imdbId);
  const seriesImdbIds = events
    .filter((e) => e.type === "episode" && e.seriesImdbId)
    .map((e) => e.seriesImdbId!);
  const allMetadataIds = [...new Set([...movieImdbIds, ...seriesImdbIds])];

  const metadata = allMetadataIds.length > 0
    ? await prisma.metadata.findMany({
        where: { imdbId: { in: allMetadataIds } },
        select: { imdbId: true, type: true, name: true, poster: true }
      })
    : [];

  const metadataByImdbId = new Map(metadata.map((m) => [m.imdbId, m]));

  const history = events.map((event) => {
    const lookupId = event.type === "episode" && event.seriesImdbId
      ? event.seriesImdbId
      : event.imdbId;
    const meta = metadataByImdbId.get(lookupId);

    return {
      ...event,
      name: meta?.name ?? null,
      poster: meta?.poster ?? null
    };
  });

  return { history };
});

app.get("/watch/stats", async () => {
  const [movieAgg, episodeAgg] = await Promise.all([
    prisma.watchEvent.aggregate({
      where: { type: "movie" },
      _count: true,
      _sum: { plays: true }
    }),
    prisma.watchEvent.aggregate({
      where: { type: "episode" },
      _count: true,
      _sum: { plays: true }
    })
  ]);

  return {
    totalMovies: movieAgg._count,
    totalEpisodes: episodeAgg._count,
    totalPlays: (movieAgg._sum.plays ?? 0) + (episodeAgg._sum.plays ?? 0)
  };
});

app.get("/watch/stats/detailed", async () => {
  // Monthly breakdown for the last 12 months
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  // Run targeted queries instead of loading all watch events into memory
  const [monthlyEvents, distinctMovieIds, distinctSeriesIds, watchDates] = await Promise.all([
    prisma.watchEvent.findMany({
      where: { watchedAt: { gte: twelveMonthsAgo } },
      select: { type: true, watchedAt: true, plays: true }
    }),
    prisma.watchEvent.findMany({
      where: { type: "movie" },
      select: { imdbId: true },
      distinct: ["imdbId"]
    }),
    prisma.watchEvent.findMany({
      where: { type: "episode", seriesImdbId: { not: null } },
      select: { seriesImdbId: true },
      distinct: ["seriesImdbId"]
    }),
    prisma.watchEvent.findMany({
      select: { watchedAt: true }
    })
  ]);

  const monthlyMap = new Map<string, { movies: number; episodes: number }>();
  for (const event of monthlyEvents) {
    const key = `${event.watchedAt.getUTCFullYear()}-${String(event.watchedAt.getUTCMonth() + 1).padStart(2, "0")}`;
    let entry = monthlyMap.get(key);
    if (!entry) {
      entry = { movies: 0, episodes: 0 };
      monthlyMap.set(key, entry);
    }
    if (event.type === "movie") entry.movies += event.plays;
    else entry.episodes += event.plays;
  }

  // Fill in missing months
  const monthly: { month: string; movies: number; episodes: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const entry = monthlyMap.get(key) ?? { movies: 0, episodes: 0 };
    monthly.push({ month: key, ...entry });
  }

  // Genre distribution from watched content (full history)
  const movieImdbIds = distinctMovieIds.map((e) => e.imdbId);
  const seriesImdbIds = distinctSeriesIds.map((e) => e.seriesImdbId!);

  const allMetadataIds = [...movieImdbIds, ...seriesImdbIds];
  const metadata = allMetadataIds.length > 0
    ? await prisma.metadata.findMany({
        where: { imdbId: { in: allMetadataIds } },
        select: { genres: true }
      })
    : [];

  const genreCounts = new Map<string, number>();
  for (const m of metadata) {
    for (const g of m.genres) {
      genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    }
  }
  const genreDistribution = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([genre, count]) => ({ genre, count }));

  // Watch streaks (full history, no day-count cap)
  const watchDays = new Set(watchDates.map((e) => e.watchedAt.toISOString().slice(0, 10)));
  const sortedDays = [...watchDays].sort();
  let longestStreak = 0;
  let currentStreak = 0;

  if (sortedDays.length > 0) {
    let streak = 1;
    for (let i = 1; i < sortedDays.length; i++) {
      const prev = new Date(sortedDays[i - 1]);
      const curr = new Date(sortedDays[i]);
      const diffMs = curr.getTime() - prev.getTime();
      if (diffMs === 86_400_000) {
        streak++;
      } else {
        if (streak > longestStreak) longestStreak = streak;
        streak = 1;
      }
    }
    if (streak > longestStreak) longestStreak = streak;

    // currentStreak: length of trailing consecutive sequence ending today
    const todayStr = new Date().toISOString().slice(0, 10);
    if (watchDays.has(todayStr)) {
      currentStreak = 1;
      for (let i = sortedDays.length - 2; i >= 0; i--) {
        const curr = new Date(sortedDays[i + 1]);
        const prev = new Date(sortedDays[i]);
        if (curr.getTime() - prev.getTime() === 86_400_000) {
          currentStreak++;
        } else {
          break;
        }
      }
    }
  }

  // Top rated watched content
  const topRated = allMetadataIds.length > 0
    ? await prisma.metadata.findMany({
        where: { imdbId: { in: allMetadataIds }, rating: { not: null } },
        select: { imdbId: true, name: true, type: true, rating: true, poster: true },
        orderBy: { rating: "desc" },
        take: 10
      })
    : [];

  return {
    monthly,
    genreDistribution,
    currentStreak,
    longestStreak,
    topRated: topRated.map((m) => ({
      imdbId: m.imdbId,
      name: m.name,
      type: m.type,
      rating: m.rating,
      poster: m.poster,
    })),
  };
});

app.get("/series/progress", async () => {
  const progressRows = await prisma.seriesProgress.findMany({
    orderBy: { lastWatchedAt: "desc" }
  });

  if (progressRows.length === 0) {
    return { progress: [] };
  }

  const imdbIds = progressRows.map((p) => p.seriesImdbId);
  const [metadata, episodeCounts] = await Promise.all([
    prisma.metadata.findMany({
      where: { imdbId: { in: imdbIds }, type: "series" },
      select: { imdbId: true, name: true, poster: true, totalSeasons: true, totalEpisodes: true }
    }),
    prisma.watchEvent.groupBy({
      by: ["seriesImdbId", "season", "episode"],
      where: { seriesImdbId: { in: imdbIds }, type: "episode" },
      _count: { _all: true }
    })
  ]);
  const metaByImdbId = new Map(metadata.map((m) => [m.imdbId, m]));
  const watchedBySeriesId = new Map<string | null, number>();
  for (const row of episodeCounts) {
    watchedBySeriesId.set(row.seriesImdbId, (watchedBySeriesId.get(row.seriesImdbId) ?? 0) + 1);
  }

  // Fetch TMDB metadata for any series without cached metadata.
  // Sync up to 10 at once (covers most dashboards); fire the rest in the background.
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

  const progress = progressRows.map((row) => {
    const meta = metaByImdbId.get(row.seriesImdbId);
    return {
      imdbId: row.seriesImdbId,
      seriesImdbId: row.seriesImdbId,
      lastSeason: row.lastSeason,
      lastEpisode: row.lastEpisode,
      // nextEpisode is an approximation — we don't store per-season episode counts,
      // so we always advance within the same season. The watch-next endpoint mirrors this.
      nextSeason: row.lastSeason,
      nextEpisode: row.lastEpisode + 1,
      lastWatchedAt: row.lastWatchedAt,
      updatedAt: row.updatedAt,
      name: meta?.name ?? row.seriesImdbId,
      poster: meta?.poster ?? null,
      totalSeasons: meta?.totalSeasons ?? null,
      totalEpisodes: meta?.totalEpisodes ?? null,
      watchedEpisodes: watchedBySeriesId.get(row.seriesImdbId) ?? null,
    };
  });

  return { progress };
});

app.post<{ Params: { imdbId: string } }>("/series/:imdbId/watch-next", async (request, reply) => {
  const { imdbId } = request.params;

  const row = await prisma.seriesProgress.findUnique({ where: { seriesImdbId: imdbId } });
  if (!row) {
    return reply.code(404).send({ error: "No progress found for this series" });
  }

  const nextEpisode = row.lastEpisode + 1;
  const nextSeason = row.lastSeason;
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
    },
  });

  await upsertSeriesProgressIfNewer(imdbId, {
    lastSeason: nextSeason,
    lastEpisode: nextEpisode,
    lastWatchedAt: watchedAt,
  });

  return reply.code(204).send();
});

app.get<{ Params: { imdbId: string } }>("/series/progress/:imdbId", async (request, reply) => {
  const { imdbId } = request.params;

  const row = await prisma.seriesProgress.findUnique({
    where: { seriesImdbId: imdbId }
  });

  if (!row) {
    return reply.code(404).send({ error: "No progress found for this series" });
  }

  const [meta, uniqueEpisodes] = await Promise.all([
    prisma.metadata.findUnique({
      where: { imdbId_type: { imdbId, type: "series" } },
      select: { name: true, poster: true, totalSeasons: true, totalEpisodes: true }
    }),
    prisma.watchEvent.groupBy({
      by: ["season", "episode"],
      where: { seriesImdbId: imdbId, type: "episode" }
    }),
  ]);
  const watchedCount = uniqueEpisodes.length;

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
      watchedEpisodes: watchedCount,
    }
  };
});

// ─── Addon Configuration ───

const ADDON_CONFIG_KEY = "addon:config";

type AddonConfig = {
  enabledCatalogs: string[];
};

// All available catalog IDs that the addon manifest can include
const ALL_ADDON_CATALOGS = [
  // Discovery catalogs
  "cataloggy-trending-movie", "cataloggy-trending-series",
  "cataloggy-popular-movie", "cataloggy-popular-series",
  "cataloggy-recommended-movie", "cataloggy-recommended-series",
  // AI catalogs (off by default; only appear in manifest when AI is configured)
  "cataloggy-ai-movie", "cataloggy-ai-series",
  // Anime
  "cataloggy-anime-series", "cataloggy-anime-movie",
  // Streaming service catalogs
  "cataloggy-netflix-movie", "cataloggy-netflix-series",
  "cataloggy-disney-movie", "cataloggy-disney-series",
  "cataloggy-amazon-movie", "cataloggy-amazon-series",
  "cataloggy-apple-movie", "cataloggy-apple-series",
  "cataloggy-max-movie", "cataloggy-max-series",
];

// Default enabled catalogs for new installs
const DEFAULT_ADDON_CATALOGS = [
  "cataloggy-trending-movie", "cataloggy-trending-series",
  "cataloggy-popular-movie", "cataloggy-popular-series",
  "cataloggy-recommended-movie", "cataloggy-recommended-series",
];

// Map legacy my_* IDs to new cataloggy-* IDs (for saved configs from before migration)
const LEGACY_CATALOG_MAP: Record<string, string> = {
  my_watchlist_movies: "cataloggy-trending-movie",
  my_watchlist_series: "cataloggy-trending-series",
  my_recent_movies: "cataloggy-popular-movie",
  my_continue_series: "cataloggy-popular-series",
};

const migrateLegacyCatalogs = (catalogs: string[]): string[] =>
  catalogs.map((c) => LEGACY_CATALOG_MAP[c] ?? c);

const getAddonConfig = async (): Promise<AddonConfig> => {
  const row = await prisma.kV.findUnique({ where: { key: ADDON_CONFIG_KEY } });
  if (!row) return { enabledCatalogs: DEFAULT_ADDON_CATALOGS };
  try {
    const parsed = JSON.parse(row.value) as AddonConfig;
    if (!Array.isArray(parsed.enabledCatalogs)) return { enabledCatalogs: DEFAULT_ADDON_CATALOGS };
    // Preserve explicit empty selection
    if (parsed.enabledCatalogs.length === 0) return { enabledCatalogs: [] };
    // Migrate legacy IDs on read
    const migrated = migrateLegacyCatalogs(parsed.enabledCatalogs);
    // Validate list-backed entries against the DB
    const listEntries = migrated.filter((c) => c.startsWith("list:"));
    let validListIds = new Set<string>();
    if (listEntries.length > 0) {
      const customLists = await prisma.list.findMany({ where: { kind: ListKind.custom }, select: { id: true } });
      validListIds = new Set(customLists.map((l) => l.id));
    }
    const valid = migrated.filter((c) =>
      ALL_ADDON_CATALOGS.includes(c) ||
      (c.startsWith("list:") && validListIds.has(c.slice(5)))
    );
    return { enabledCatalogs: valid.length > 0 ? valid : DEFAULT_ADDON_CATALOGS };
  } catch {
    return { enabledCatalogs: DEFAULT_ADDON_CATALOGS };
  }
};

app.get("/addon/config", async () => {
  const config = await getAddonConfig();
  const userLists = await prisma.list.findMany({
    where: { kind: ListKind.custom },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" }
  });
  return { config, availableCatalogs: ALL_ADDON_CATALOGS, availableLists: userLists };
});

app.post<{ Body: unknown }>("/addon/config", async (request, reply) => {
  const body = request.body as { enabledCatalogs?: unknown } | null;
  if (!body || !Array.isArray(body.enabledCatalogs)) {
    return reply.code(400).send({ error: "enabledCatalogs must be an array of strings" });
  }

  // Fetch custom list IDs to validate list-based catalog entries
  const userLists = await prisma.list.findMany({ where: { kind: ListKind.custom }, select: { id: true } });
  const validListIds = new Set(userLists.map((l) => l.id));

  const enabled = (body.enabledCatalogs as unknown[]).filter(
    (c): c is string => {
      if (typeof c !== "string") return false;
      if (ALL_ADDON_CATALOGS.includes(c)) return true;
      // Allow list:{uuid} entries for user-created lists
      if (c.startsWith("list:")) {
        const listId = c.slice(5);
        return validListIds.has(listId);
      }
      return false;
    }
  );
  const config: AddonConfig = { enabledCatalogs: enabled };
  await prisma.kV.upsert({
    where: { key: ADDON_CONFIG_KEY },
    create: { key: ADDON_CONFIG_KEY, value: JSON.stringify(config), updatedAt: new Date() },
    update: { value: JSON.stringify(config), updatedAt: new Date() }
  });
  return { config };
});

// ─── OMDB (Open Movie Database) ───

const OMDB_API_KEY_KV = "omdb:apiKey";

const getOmdbApiKey = async (): Promise<string | null> => {
  const row = await prisma.kV.findUnique({ where: { key: OMDB_API_KEY_KV } });
  return row?.value?.trim() || null;
};

type OmdbRatings = {
  imdbRating: number | null;
  rtScore: number | null;
  mcScore: number | null;
};

const fetchOmdbRatings = async (imdbId: string, apiKey: string): Promise<OmdbRatings> => {
  const url = `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return { imdbRating: null, rtScore: null, mcScore: null };
  const data = await res.json() as {
    Response?: string;
    imdbRating?: string;
    Ratings?: Array<{ Source: string; Value: string }>;
  };
  if (data.Response !== "True") return { imdbRating: null, rtScore: null, mcScore: null };

  const rawImdb = data.imdbRating && data.imdbRating !== "N/A" ? parseFloat(data.imdbRating) : NaN;
  const imdbRating = isNaN(rawImdb) ? null : rawImdb;

  const rtValue = data.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value;
  const rawRt = rtValue ? parseInt(rtValue.replace("%", ""), 10) : NaN;
  const rtScore = isNaN(rawRt) ? null : rawRt;

  const mcValue = data.Ratings?.find((r) => r.Source === "Metacritic")?.Value;
  const rawMc = mcValue ? parseInt(mcValue.split("/")[0], 10) : NaN;
  const mcScore = isNaN(rawMc) ? null : rawMc;

  return { imdbRating, rtScore, mcScore };
};

const upsertOmdbRatings = async (imdbId: string, type: MetadataType, ratings: OmdbRatings) => {
  return prisma.metadata.update({
    where: { imdbId_type: { imdbId, type } },
    data: { imdbRating: ratings.imdbRating, rtScore: ratings.rtScore, mcScore: ratings.mcScore },
  });
};

app.get("/omdb/status", async () => {
  const apiKey = await getOmdbApiKey();
  return { configured: !!apiKey };
});

app.post<{ Body: unknown }>("/omdb/key", async (request, reply) => {
  const body = request.body as { apiKey?: unknown } | null;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) {
    await prisma.kV.deleteMany({ where: { key: OMDB_API_KEY_KV } });
    return { configured: false };
  }
  // Validate key against OMDB
  try {
    const testUrl = `https://www.omdbapi.com/?i=tt0111161&apikey=${encodeURIComponent(apiKey)}`;
    const testRes = await fetch(testUrl, { signal: AbortSignal.timeout(8000) });
    const testData = await testRes.json() as { Response?: string; Error?: string };
    if (testData.Response === "False") {
      return reply.code(400).send({ error: testData.Error ?? "Invalid OMDB API key" });
    }
  } catch {
    return reply.code(400).send({ error: "Could not reach OMDB API to validate key" });
  }
  await prisma.kV.upsert({
    where: { key: OMDB_API_KEY_KV },
    create: { key: OMDB_API_KEY_KV, value: apiKey, updatedAt: new Date() },
    update: { value: apiKey, updatedAt: new Date() },
  });
  return { configured: true };
});

app.delete("/omdb/key", async () => {
  await prisma.kV.deleteMany({ where: { key: OMDB_API_KEY_KV } });
  return { configured: false };
});

// ─── RPDB (Rating Poster Database) ───

const RPDB_API_KEY_KV = "rpdb:apiKey";
const RPDB_BASE_URL = "https://api.ratingposterdb.com";

const getRpdbApiKey = async (): Promise<string | null> => {
  const row = await prisma.kV.findUnique({ where: { key: RPDB_API_KEY_KV } });
  return row?.value?.trim() || null;
};

const buildRpdbPosterUrl = (rpdbKey: string, imdbId: string): string =>
  `${RPDB_BASE_URL}/${rpdbKey}/imdb/poster-default/${imdbId}.jpg`;

// Apply RPDB poster if key is configured, otherwise fall back to existing poster
const withRpdbPoster = (imdbId: string, fallback: string | null | undefined, rpdbKey: string | null): string | null =>
  rpdbKey ? buildRpdbPosterUrl(rpdbKey, imdbId) : (fallback ?? null);

const applyRpdbToMetaList = (metas: StremioMetaPreview[], rpdbKey: string | null): StremioMetaPreview[] => {
  if (!rpdbKey) return metas;
  return metas.map((m) => ({ ...m, poster: buildRpdbPosterUrl(rpdbKey, m.id) }));
};

app.get("/rpdb/status", async () => {
  const apiKey = await getRpdbApiKey();
  return {
    configured: !!apiKey,
    hasKey: !!apiKey,
  };
});

app.post<{ Body: unknown }>("/rpdb/key", async (request, reply) => {
  const body = request.body as { apiKey?: unknown } | null;
  if (!body || typeof body.apiKey !== "string") {
    return reply.code(400).send({ error: "apiKey must be a string" });
  }

  const apiKey = body.apiKey.trim();
  if (!apiKey) {
    // Remove key
    await prisma.kV.deleteMany({ where: { key: RPDB_API_KEY_KV } });
    return { configured: false };
  }

  await prisma.kV.upsert({
    where: { key: RPDB_API_KEY_KV },
    create: { key: RPDB_API_KEY_KV, value: apiKey, updatedAt: new Date() },
    update: { value: apiKey, updatedAt: new Date() }
  });
  return { configured: true };
});

app.delete("/rpdb/key", async () => {
  await prisma.kV.deleteMany({ where: { key: RPDB_API_KEY_KV } });
  return { configured: false };
});

// Internal helper: get RPDB poster for a given IMDB ID (used by addon)
app.get<{ Params: { imdbId: string } }>("/rpdb/poster/:imdbId", async (request, reply) => {
  const rpdbKey = await getRpdbApiKey();
  if (!rpdbKey) {
    return reply.code(404).send({ error: "RPDB not configured" });
  }
  return { poster: buildRpdbPosterUrl(rpdbKey, request.params.imdbId) };
});

// Bulk endpoint for addon: get RPDB key status and key itself (internal only)
app.get("/rpdb/config", async () => {
  const apiKey = await getRpdbApiKey();
  return {
    enabled: !!apiKey,
    apiKey: apiKey ?? null,
  };
});

// ─── AI Config Routes ───

app.get("/ai/config", async () => {
  const config = await getAiConfig();
  const configured = !!(config?.url && config?.headers && config?.payload?.model);
  const lastGenRow = await prisma.kV.findUnique({ where: { key: AI_LAST_RECS_GENERATED_AT_KEY } });
  return {
    configured,
    config: configured ? redactAiConfig(config!) : null,
    lastGeneratedAt: lastGenRow?.value ?? null,
  };
});

app.post<{ Body: unknown }>("/ai/config", async (request, reply) => {
  const body = request.body as { config?: unknown } | null;
  const cfg = body?.config as Record<string, unknown> | undefined;

  if (!cfg || typeof cfg.url !== "string" || !cfg.url.startsWith("http")) {
    return reply.code(400).send({ error: "config.url must be a non-empty string starting with http" });
  }
  if (!cfg.headers || typeof cfg.headers !== "object" || Array.isArray(cfg.headers)) {
    return reply.code(400).send({ error: "config.headers must be an object" });
  }
  if (!cfg.payload || typeof cfg.payload !== "object" || Array.isArray(cfg.payload)) {
    return reply.code(400).send({ error: "config.payload must be an object" });
  }
  const payload = cfg.payload as Record<string, unknown>;
  if (typeof payload.model !== "string" || !payload.model) {
    return reply.code(400).send({ error: "config.payload.model must be a non-empty string" });
  }

  const validConfig: AiProviderConfig = {
    url: cfg.url,
    headers: cfg.headers as Record<string, string>,
    payload: payload,
  };

  await prisma.kV.upsert({
    where: { key: AI_CONFIG_KEY },
    create: { key: AI_CONFIG_KEY, value: JSON.stringify(validConfig), updatedAt: new Date() },
    update: { value: JSON.stringify(validConfig), updatedAt: new Date() },
  });

  // Bust cached AI recs so next request regenerates with new config
  for (const key of ["ai-recs:movie", "ai-recs:series"]) {
    trendingCache.delete(key);
  }

  return { configured: true };
});

app.delete("/ai/config", async () => {
  await prisma.kV.deleteMany({ where: { key: AI_CONFIG_KEY } });
  for (const key of ["ai-recs:movie", "ai-recs:series"]) {
    trendingCache.delete(key);
  }
  return { configured: false };
});

app.post<{ Body: unknown }>("/ai/test", async (request) => {
  const body = request.body as { config?: unknown } | null;
  const cfg = body?.config as Record<string, unknown> | undefined;

  if (!cfg || typeof cfg.url !== "string" || !cfg.url.startsWith("http") ||
      !cfg.headers || typeof cfg.headers !== "object" || Array.isArray(cfg.headers) ||
      !cfg.payload || typeof cfg.payload !== "object" || Array.isArray(cfg.payload) ||
      typeof (cfg.payload as Record<string, unknown>).model !== "string") {
    return { success: false, error: "Invalid config: url, headers, and payload.model are required" };
  }

  const testConfig: AiProviderConfig = {
    url: cfg.url,
    headers: cfg.headers as Record<string, string>,
    payload: {
      ...(cfg.payload as Record<string, unknown>),
      messages: [{ role: "user", content: "Reply with the single word OK and nothing else. No punctuation." }],
      stream: false,
      max_tokens: 20,
    },
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(testConfig.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...testConfig.headers },
        body: JSON.stringify(testConfig.payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      return { success: false, error: `HTTP ${response.status}: ${errBody.slice(0, 200)}` };
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = (data.choices?.[0]?.message?.content ?? "").trim().slice(0, 100);
    return { success: true, response: content };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ─── Duplicate detection ───

app.get<{ Params: { imdbId: string }; Querystring: { type?: string } }>("/items/:imdbId/lists", async (request) => {
  const { imdbId } = request.params;
  const typeFilter = request.query.type;

  const where: { imdbId: string; type?: ListItemType } = { imdbId };
  if (typeFilter && Object.values(ListItemType).includes(typeFilter as ListItemType)) {
    where.type = typeFilter as ListItemType;
  }

  const listItems = await prisma.listItem.findMany({
    where,
    include: { list: { select: { id: true, name: true, kind: true } } }
  });

  return {
    lists: listItems.map((item) => ({
      listId: item.list.id,
      listName: item.list.name,
      listKind: item.list.kind,
      type: item.type,
      addedAt: item.addedAt,
    }))
  };
});

app.post("/trakt/import", async (request, reply) => {
  let client: TraktClient;
  try {
    client = await getTraktClient();
  } catch (error) {
    request.log.error(error, "Trakt client initialization failed");
    return reply.code(500).send({ error: "Trakt integration is not configured" });
  }

  const [watchedMovies, watchedShows, watchlistMovies, watchlistShows] = await Promise.all([
    client.fetchWatchedMovies(request.log),
    client.fetchWatchedShows(request.log),
    client.fetchWatchlistMovies(request.log),
    client.fetchWatchlistShows(request.log),
  ]);

  const imported = { movies: 0, episodes: 0, watchlistMovies: 0, watchlistShows: 0 };

  // ── Import Trakt watchlist into the default watchlist ──
  const watchlist = await getDefaultWatchlist();

  for (const entry of watchlistMovies) {
    const imdbId = entry.movie?.ids?.imdb;
    const title = entry.movie?.title?.trim();
    if (!imdbId) continue;

    await prisma.item.upsert({
      where: { type_imdbId: { type: ItemType.movie, imdbId } },
      create: { type: ItemType.movie, imdbId, title: title || undefined },
      update: title ? { title } : {}
    });

    try {
      await prisma.listItem.create({
        data: { listId: watchlist.id, type: ListItemType.movie, imdbId }
      });
      imported.watchlistMovies += 1;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      // already in watchlist – skip
    }
  }

  for (const entry of watchlistShows) {
    const imdbId = entry.show?.ids?.imdb;
    const title = entry.show?.title?.trim();
    if (!imdbId) continue;

    await prisma.item.upsert({
      where: { type_imdbId: { type: ItemType.series, imdbId } },
      create: { type: ItemType.series, imdbId, title: title || undefined },
      update: title ? { title } : {}
    });

    try {
      await prisma.listItem.create({
        data: { listId: watchlist.id, type: ListItemType.series, imdbId }
      });
      imported.watchlistShows += 1;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      // already in watchlist – skip
    }
  }
  const seriesProgressByImdb = new Map<string, SeriesProgressCandidate>();

  for (const entry of watchedMovies) {
    const imdbId = entry.movie?.ids?.imdb;
    const watchedAt = entry.last_watched_at;

    if (!imdbId || !watchedAt) {
      continue;
    }

    const existing = await prisma.watchEvent.findFirst({
      where: { type: "movie", imdbId }
    });

    if (existing) {
      await prisma.watchEvent.update({
        where: { id: existing.id },
        data: {
          watchedAt: new Date(watchedAt),
          plays: entry.plays ?? 1
        }
      });
    } else {
      await prisma.watchEvent.create({
        data: {
          type: "movie",
          imdbId,
          watchedAt: new Date(watchedAt),
          plays: entry.plays ?? 1
        }
      });
    }

    imported.movies += 1;
  }

  for (const entry of watchedShows) {
    const seriesImdbId = entry.show?.ids?.imdb;
    if (!seriesImdbId) {
      continue;
    }

    for (const season of entry.seasons ?? []) {
      const seasonNumber = season.number;
      if (seasonNumber === undefined) {
        continue;
      }

      for (const ep of season.episodes ?? []) {
        const episodeNumber = ep.number;
        const watchedAt = ep.last_watched_at;

        if (episodeNumber === undefined || !watchedAt) {
          continue;
        }

        const existing = await prisma.watchEvent.findFirst({
          where: {
            type: "episode",
            seriesImdbId,
            season: seasonNumber,
            episode: episodeNumber
          }
        });

        if (existing) {
          await prisma.watchEvent.update({
            where: { id: existing.id },
            data: {
              watchedAt: new Date(watchedAt),
              plays: ep.plays ?? 1
            }
          });
        } else {
          await prisma.watchEvent.create({
            data: {
              type: "episode",
              imdbId: seriesImdbId,
              seriesImdbId,
              season: seasonNumber,
              episode: episodeNumber,
              watchedAt: new Date(watchedAt),
              plays: ep.plays ?? 1
            }
          });
        }

        const watchedAtDate = new Date(watchedAt);
        const existingProgress = seriesProgressByImdb.get(seriesImdbId);
        if (
          !existingProgress ||
          watchedAtDate.getTime() > existingProgress.lastWatchedAt.getTime() ||
          (watchedAtDate.getTime() === existingProgress.lastWatchedAt.getTime() &&
            (seasonNumber > existingProgress.lastSeason ||
              (seasonNumber === existingProgress.lastSeason && episodeNumber > existingProgress.lastEpisode)))
        ) {
          seriesProgressByImdb.set(seriesImdbId, {
            lastSeason: seasonNumber,
            lastEpisode: episodeNumber,
            lastWatchedAt: watchedAtDate
          });
        }

        imported.episodes += 1;
      }
    }
  }

  for (const [seriesImdbId, progress] of seriesProgressByImdb.entries()) {
    await upsertSeriesProgressIfNewer(seriesImdbId, progress);
  }

  // ── Background metadata fetch for all imported series & movies ──
  // Collect all IMDb IDs that were just imported and kick off TMDB syncs
  // in the background so posters are available on the next dashboard load.
  const movieImdbIds = watchedMovies
    .map((e) => e.movie?.ids?.imdb)
    .filter((id): id is string => !!id);
  const seriesImdbIds = [
    ...new Set([
      ...watchedShows.map((e) => e.show?.ids?.imdb).filter((id): id is string => !!id),
      ...watchlistShows.map((e) => e.show?.ids?.imdb).filter((id): id is string => !!id),
    ]),
  ];
  const watchlistMovieImdbIds = watchlistMovies
    .map((e) => e.movie?.ids?.imdb)
    .filter((id): id is string => !!id);

  const allMovieIds = [...new Set([...movieImdbIds, ...watchlistMovieImdbIds])];

  void (async () => {
    try {
      const tmdb = await getTmdb();
      for (const id of allMovieIds) {
        try {
          const payload = await tmdb.findByImdbId(MetadataType.movie, id);
          if (payload) await upsertMetadata(payload);
        } catch { /* skip individual failures */ }
      }
      for (const id of seriesImdbIds) {
        try {
          const payload = await tmdb.findByImdbId(MetadataType.series, id);
          if (payload) await upsertMetadata(payload);
        } catch { /* skip individual failures */ }
      }
    } catch { /* TMDB unavailable */ }
  })();

  return reply.code(200).send({ imported });
});

app.get("/trakt/status", async (_request, reply) => {
  const token = await prisma.traktToken.findUnique({ where: { id: "default" } });
  const configured = !!(process.env.TRAKT_CLIENT_ID && process.env.TRAKT_CLIENT_SECRET);
  const redirectUri = process.env.TRAKT_REDIRECT_URI ?? `${process.env.CATALOGGY_API_PUBLIC ?? "http://localhost:7000"}/trakt/oauth/callback`;
  return reply.send({
    connected: !!token,
    configured,
    expiresAt: token?.expiresAt ?? null,
    redirectUri
  });
});

app.get("/trakt/oauth/authorize", async (_request, reply) => {
  const clientId = process.env.TRAKT_CLIENT_ID;
  const redirectUri = process.env.TRAKT_REDIRECT_URI ?? `${process.env.CATALOGGY_API_PUBLIC ?? "http://localhost:7000"}/trakt/oauth/callback`;
  if (!clientId) {
    return reply.code(500).send({ error: "TRAKT_CLIENT_ID is not configured" });
  }
  const url = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return reply.send({ url, redirectUri });
});

app.get("/trakt/oauth/callback", async (request, reply) => {
  const { code, error: oauthError, error_description: oauthErrorDescription } = request.query as {
    code?: string;
    error?: string;
    error_description?: string;
  };

  if (oauthError) {
    request.log.warn({ error: oauthError, error_description: oauthErrorDescription }, "Trakt OAuth denied");
    const safeMessage = escapeHtml(oauthErrorDescription ?? oauthError);
    return reply.code(403).type("text/html").send(renderOAuthHtml(safeMessage, "Trakt Authorization Failed"));
  }

  if (!code) {
    return reply.code(400).send({ error: "Missing authorization code" });
  }

  const clientId = process.env.TRAKT_CLIENT_ID;
  const clientSecret = process.env.TRAKT_CLIENT_SECRET;
  const redirectUri = process.env.TRAKT_REDIRECT_URI ?? `${process.env.CATALOGGY_API_PUBLIC ?? "http://localhost:7000"}/trakt/oauth/callback`;

  if (!clientId || !clientSecret) {
    return reply.code(500).send({ error: "Trakt credentials are not configured" });
  }

  const tokenExchangeController = new AbortController();
  const tokenExchangeTimeout = setTimeout(() => tokenExchangeController.abort(), 30_000);

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://api.trakt.tv/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: tokenExchangeController.signal,
      body: JSON.stringify({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
  } catch (err) {
    clearTimeout(tokenExchangeTimeout);
    const detail = tokenExchangeController.signal.aborted
      ? "Trakt token exchange timed out. Please try again."
      : "Could not reach Trakt servers. Please check your network and try again.";
    request.log.error(err, "Trakt token exchange fetch failed");
    return reply.code(502).type("text/html").send(renderOAuthHtml(detail));
  }
  clearTimeout(tokenExchangeTimeout);

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    request.log.error({ status: tokenResponse.status, body }, "Trakt token exchange failed");
    let detail = "Failed to exchange authorization code";
    if (tokenResponse.status === 401) {
      detail = "Trakt client credentials are invalid. Check TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET.";
    } else if (tokenResponse.status === 403) {
      detail = "Trakt redirect URI mismatch. Check TRAKT_REDIRECT_URI matches what is registered in your Trakt app settings.";
    }
    return reply.code(502).type("text/html").send(renderOAuthHtml(detail));
  }

  const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token: string; expires_in?: number };
  const expiresAt = computeTokenExpiresAt(tokens.expires_in);

  await prisma.traktToken.upsert({
    where: { id: "default" },
    update: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt },
    create: { id: "default", accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt }
  });

  traktClient = null;

  return reply.type("text/html").send(renderOAuthHtml("You can close this tab and return to Cataloggy.", "Trakt Connected!"));
});

app.post("/trakt/disconnect", async (_request, reply) => {
  await prisma.traktToken.deleteMany();
  traktClient = null;
  return reply.send({ disconnected: true });
});

app.post("/metadata/refresh-all", async (request, reply) => {
  const allMetadata = await prisma.metadata.findMany({ select: { imdbId: true, type: true } });
  if (allMetadata.length === 0) {
    return reply.send({ refreshed: 0, total: 0 });
  }

  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 500;
  let tmdb: TmdbClient;
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
              await upsertOmdbRatings(item.imdbId, item.type, omdb);
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
        request.log.warn({ imdbId: item.imdbId, type: item.type, error: result.reason }, "Failed to refresh metadata");
      }
    }

    if (i + BATCH_SIZE < allMetadata.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  return reply.send({ refreshed, total: allMetadata.length });
});

// ─── Scrobbling ───

const SCROBBLE_COMPLETE_THRESHOLD = 80; // percentage at which a scrobble counts as "watched"
const SCROBBLE_STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SCROBBLE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // run cleanup every hour

const cleanupStaleSessions = async () => {
  const cutoff = new Date(Date.now() - SCROBBLE_STALE_TTL_MS);
  const { count } = await prisma.scrobbleSession.updateMany({
    where: {
      status: { in: [ScrobbleStatus.playing, ScrobbleStatus.paused] },
      updatedAt: { lt: cutoff }
    },
    data: { status: ScrobbleStatus.stopped }
  });
  if (count > 0) {
    app.log.info({ count }, "Cleaned up stale scrobble sessions");
  }
};

app.post<{ Body: unknown }>("/scrobble/start", async (request, reply) => {
  if (!request.body || typeof request.body !== "object") {
    return reply.code(400).send({ error: "type and imdbId are required" });
  }

  const body = request.body as {
    type?: unknown;
    imdbId?: unknown;
    seriesImdbId?: unknown;
    season?: unknown;
    episode?: unknown;
    progress?: unknown;
  };

  if (!Object.values(WatchEventType).includes(body.type as WatchEventType)) {
    return reply.code(400).send({ error: "type must be one of: movie, episode" });
  }

  if (typeof body.imdbId !== "string" || !body.imdbId.trim()) {
    return reply.code(400).send({ error: "imdbId is required" });
  }

  const type = body.type as WatchEventType;
  const imdbId = body.imdbId.trim();
  const seriesImdbId = typeof body.seriesImdbId === "string" ? body.seriesImdbId.trim() || null : null;
  const season = typeof body.season === "number" && Number.isInteger(body.season) ? body.season : null;
  const episode = typeof body.episode === "number" && Number.isInteger(body.episode) ? body.episode : null;
  const progress = typeof body.progress === "number" ? Math.max(0, Math.min(100, body.progress)) : 0;

  // Atomically find-and-update or create to avoid duplicate active sessions
  const { session, created } = await prisma.$transaction(async (tx) => {
    const existing = await tx.scrobbleSession.findFirst({
      where: {
        imdbId,
        season,
        episode,
        status: { in: [ScrobbleStatus.playing, ScrobbleStatus.paused] }
      }
    });

    if (existing) {
      const updated = await tx.scrobbleSession.update({
        where: { id: existing.id },
        data: { status: ScrobbleStatus.playing, progress }
      });
      return { session: updated, created: false };
    }

    const newSession = await tx.scrobbleSession.create({
      data: { type, imdbId, seriesImdbId, season, episode, status: ScrobbleStatus.playing, progress }
    });
    return { session: newSession, created: true };
  });

  return reply.code(created ? 201 : 200).send({ session });
});

app.post<{ Body: unknown }>("/scrobble/pause", async (request, reply) => {
  if (!request.body || typeof request.body !== "object") {
    return reply.code(400).send({ error: "imdbId is required" });
  }

  const body = request.body as { imdbId?: unknown; season?: unknown; episode?: unknown; progress?: unknown };
  if (typeof body.imdbId !== "string" || !body.imdbId.trim()) {
    return reply.code(400).send({ error: "imdbId is required" });
  }

  const imdbId = body.imdbId.trim();
  const season = typeof body.season === "number" ? body.season : null;
  const episode = typeof body.episode === "number" ? body.episode : null;
  const progress = typeof body.progress === "number" ? Math.max(0, Math.min(100, body.progress)) : undefined;

  const session = await prisma.scrobbleSession.findFirst({
    where: { imdbId, season, episode, status: ScrobbleStatus.playing }
  });

  if (!session) {
    return reply.code(404).send({ error: "No active scrobble session found" });
  }

  const updated = await prisma.scrobbleSession.update({
    where: { id: session.id },
    data: { status: ScrobbleStatus.paused, ...(progress !== undefined ? { progress } : {}) }
  });

  return reply.code(200).send({ session: updated });
});

app.post<{ Body: unknown }>("/scrobble/stop", async (request, reply) => {
  if (!request.body || typeof request.body !== "object") {
    return reply.code(400).send({ error: "imdbId is required" });
  }

  const body = request.body as { imdbId?: unknown; season?: unknown; episode?: unknown; progress?: unknown };
  if (typeof body.imdbId !== "string" || !body.imdbId.trim()) {
    return reply.code(400).send({ error: "imdbId is required" });
  }

  const imdbId = body.imdbId.trim();
  const season = typeof body.season === "number" ? body.season : null;
  const episode = typeof body.episode === "number" ? body.episode : null;
  const progress = typeof body.progress === "number" ? Math.max(0, Math.min(100, body.progress)) : undefined;

  const session = await prisma.scrobbleSession.findFirst({
    where: { imdbId, season, episode, status: { in: [ScrobbleStatus.playing, ScrobbleStatus.paused] } }
  });

  if (!session) {
    return reply.code(404).send({ error: "No active scrobble session found" });
  }

  const finalProgress = progress ?? session.progress;
  const watchedAt = new Date();
  const seriesImdbId = session.seriesImdbId;

  // Wrap session stop + watch event creation in a transaction for atomicity
  const { stoppedSession, watchEvent } = await prisma.$transaction(async (tx) => {
    const stoppedSession = await tx.scrobbleSession.update({
      where: { id: session.id },
      data: { status: ScrobbleStatus.stopped, progress: finalProgress }
    });

    let watchEvent = null;
    if (finalProgress >= SCROBBLE_COMPLETE_THRESHOLD) {
      const dayStart = new Date(watchedAt);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(watchedAt);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const existingEvent = await tx.watchEvent.findFirst({
        where: {
          imdbId,
          season: session.season,
          episode: session.episode,
          watchedAt: { gte: dayStart, lte: dayEnd }
        }
      });

      if (existingEvent) {
        watchEvent = await tx.watchEvent.update({
          where: { id: existingEvent.id },
          data: { plays: existingEvent.plays + 1 }
        });
      } else {
        watchEvent = await tx.watchEvent.create({
          data: {
            type: session.type,
            imdbId,
            seriesImdbId,
            season: session.season,
            episode: session.episode,
            watchedAt,
            plays: 1
          }
        });
      }
    }

    return { stoppedSession, watchEvent };
  });

  // Update series progress outside transaction (idempotent)
  if (watchEvent && session.type === "episode" && seriesImdbId && session.season !== null && session.episode !== null) {
    await upsertSeriesProgressIfNewer(seriesImdbId, {
      lastSeason: session.season,
      lastEpisode: session.episode,
      lastWatchedAt: watchedAt
    });
  }

  return reply.code(200).send({
    session: { id: stoppedSession.id, status: stoppedSession.status, progress: finalProgress },
    recorded: !!watchEvent,
    watchEvent
  });
});

app.get("/scrobble/now-playing", async () => {
  const sessions = await prisma.scrobbleSession.findMany({
    where: { status: { in: [ScrobbleStatus.playing, ScrobbleStatus.paused] } },
    orderBy: { updatedAt: "desc" }
  });

  if (sessions.length === 0) {
    return { sessions: [] };
  }

  // Enrich with metadata
  const imdbIds = [...new Set([
    ...sessions.map((s) => s.imdbId),
    ...sessions.filter((s) => s.seriesImdbId).map((s) => s.seriesImdbId!)
  ])];

  const metadata = imdbIds.length > 0
    ? await prisma.metadata.findMany({
        where: { imdbId: { in: imdbIds } },
        select: { imdbId: true, name: true, poster: true }
      })
    : [];

  const metaByImdbId = new Map(metadata.map((m) => [m.imdbId, m]));

  return {
    sessions: sessions.map((session) => {
      const lookupId = session.type === "episode" && session.seriesImdbId
        ? session.seriesImdbId
        : session.imdbId;
      const meta = metaByImdbId.get(lookupId);

      return {
        ...session,
        name: meta?.name ?? null,
        poster: meta?.poster ?? null
      };
    })
  };
});

app.post("/trakt/poll", async (request, reply) => {
  try {
    const result = await pollTraktHistory(request.log);
    return reply.code(200).send(result);
  } catch (error) {
    request.log.error(error, "Trakt poll failed");
    return reply.code(500).send({ error: "Trakt poll failed" });
  }
});

// ─── Stremio Addon ───
// These routes are public (no auth) – see the auth bypass hook above.

const STREMIO_ADDON_ID = "com.cataloggy.addon";
const STREMIO_ADDON_VERSION = "1.0.0";

// The static catalog IDs that are always available (watchlist / history)
const CORE_STREMIO_CATALOGS = [
  { id: "my_watchlist_movies", type: "movie" as const, name: "My Watchlist – Movies" },
  { id: "my_watchlist_series", type: "series" as const, name: "My Watchlist – Series" },
  { id: "my_recent_movies", type: "movie" as const, name: "Recently Watched Movies" },
  { id: "my_continue_series", type: "series" as const, name: "Continue Watching" },
];

// Map from addon catalog ID to discovery catalog ID used by the discovery endpoints
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

app.get("/addon/stremio/manifest.json", async () => {
  const [config, aiConfigured] = await Promise.all([getAddonConfig(), isAiConfigured()]);

  const enabledCatalogs = config.enabledCatalogs.filter((id) => {
    if (id === "cataloggy-ai-movie" || id === "cataloggy-ai-series") {
      return aiConfigured;
    }
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

  // Add user list catalogs (each list exposes as two catalogs: movies + series)
  const listCatalogIds = enabledCatalogs.filter((id) => id.startsWith("list:"));
  if (listCatalogIds.length > 0) {
    const listIds = listCatalogIds.map((id) => id.slice(5));
    const userLists = await prisma.list.findMany({
      where: { id: { in: listIds } },
      select: { id: true, name: true }
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

// Stremio-compatible catalog handler: /addon/stremio/:type/catalog/:id.json
app.get<{ Params: { type: string; id: string }; Querystring: { skip?: string } }>(
  "/addon/stremio/:type/catalog/:id.json",
  async (request, reply) => {
    const { type: rawType, id: catalogId } = request.params;
    const type = parseMetaType(rawType);
    if (!type) return reply.code(400).send({ metas: [] });

    const limit = parseCatalogLimit(undefined);

    // Core / personal catalogs — validate URL type matches the catalog's expected type
    if (catalogId === "my_watchlist_movies") {
      if (type !== "movie") return reply.code(400).send({ metas: [] });
      const metas = await getWatchlistMetas("movie", limit);
      return { metas };
    }
    if (catalogId === "my_watchlist_series") {
      if (type !== "series") return reply.code(400).send({ metas: [] });
      const metas = await getWatchlistMetas("series", limit);
      return { metas };
    }
    if (catalogId === "my_recent_movies") {
      if (type !== "movie") return reply.code(400).send({ metas: [] });
      const metas = await getRecentMetas("movie", limit);
      return { metas };
    }
    if (catalogId === "my_continue_series") {
      if (type !== "series") return reply.code(400).send({ metas: [] });
      const metas = await getContinueMetas(limit);
      return { metas };
    }

    // User list catalogs (list:{uuid})
    if (catalogId.startsWith("list:")) {
      const listId = catalogId.slice(5);
      const list = await prisma.list.findUnique({ where: { id: listId }, select: { id: true } });
      if (!list) return reply.code(404).send({ metas: [] });
      const metas = await getCustomListMetas(listId, type, limit);
      return { metas };
    }

    // Discovery catalogs
    const discovery = DISCOVERY_CATALOG_MAP[catalogId];
    if (!discovery) return reply.code(404).send({ metas: [] });

    // Validate that the URL type matches the catalog's declared type
    if (discovery.type !== type) return reply.code(400).send({ metas: [] });

    const cacheKey = discovery.endpoint;
    const cached = trendingCacheGet(cacheKey);
    if (cached) return { metas: cached.data };

    // Fetch from the appropriate source
    try {
      const tmdb = await getTmdb();
      const metaType = discovery.type === "movie" ? MetadataType.movie : MetadataType.series;
      let results: MetadataPayload[];

      if (cacheKey.startsWith("trending:")) {
        const window = cacheKey.endsWith(":day") ? "day" as const : "week" as const;
        results = await tmdb.trending(metaType, window);
      } else if (cacheKey.startsWith("popular:")) {
        results = await tmdb.popular(metaType);
      } else if (cacheKey.startsWith("ai-recs:")) {
        const aiType = cacheKey.split(":")[1] as "movie" | "series";
        const result = await getAiRecommendations(aiType, 20);
        if (!result) return { metas: [] };
        return { metas: result.metas };
      } else if (cacheKey.startsWith("recommended:")) {
        // Use AI recommendations when configured
        if (await isAiConfigured()) {
          const aiResult = await getAiRecommendations(discovery.type, 20);
          if (aiResult) {
            trendingCacheSet(cacheKey, { data: aiResult.metas, expiry: Date.now() + TRENDING_CACHE_TTL_MS });
            return { metas: aiResult.metas };
          }
          // Fall through to TMDB if AI fails
        }
        const recentItems = metaType === MetadataType.movie
          ? (await prisma.watchEvent.findMany({ where: { type: "movie" }, orderBy: { watchedAt: "desc" }, take: 3, distinct: ["imdbId"], select: { imdbId: true } })).map((r) => r.imdbId)
          : (await prisma.seriesProgress.findMany({ orderBy: { lastWatchedAt: "desc" }, take: 3, select: { seriesImdbId: true } })).map((r) => r.seriesImdbId);
        if (recentItems.length === 0) return { metas: [] };
        const seedMetas = await prisma.metadata.findMany({ where: { imdbId: { in: recentItems }, type: metaType }, select: { tmdbId: true } });
        const tmdbIds = seedMetas.filter((m) => m.tmdbId).map((m) => m.tmdbId as number);
        if (tmdbIds.length === 0) return { metas: [] };
        // Fetch from up to 3 seeds, merge and deduplicate by imdbId
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
        const region = await getRegionSetting();
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
      trendingCacheSet(cacheKey, { data: metas, expiry: Date.now() + TRENDING_CACHE_TTL_MS });
      return { metas };
    } catch {
      return { metas: [] };
    }
  }
);

const start = async () => {
  const port = Number(process.env.PORT ?? 7000);
  await ensureDefaultWatchlist();

  if (TRAKT_POLL_INTERVAL_SEC > 0) {
    setInterval(() => {
      void pollTraktHistory(app.log).catch((error) => {
        app.log.error(error, "Scheduled Trakt poll failed");
      });
    }, TRAKT_POLL_INTERVAL_SEC * 1000);
  } else {
    app.log.info("Scheduled Trakt poll disabled because TRAKT_POLL_INTERVAL_SEC is set to 0");
  }

  // Periodic cleanup of stale scrobble sessions
  setInterval(() => {
    void cleanupStaleSessions().catch((error) => {
      app.log.error(error, "Scrobble session cleanup failed");
    });
  }, SCROBBLE_CLEANUP_INTERVAL_MS);

  const refreshAiRecommendations = async () => {
    if (!(await isAiConfigured())) return;
    trendingCache.delete("ai-recs:movie");
    trendingCache.delete("ai-recs:series");
    await Promise.allSettled([
      getAiRecommendations("movie", 15),
      getAiRecommendations("series", 15),
    ]);
  };

  if (AI_REFRESH_INTERVAL_SEC > 0) {
    setTimeout(() => {
      void refreshAiRecommendations().catch((error) => {
        app.log.error(error, "Initial AI recommendations refresh failed");
      });
      setInterval(() => {
        void refreshAiRecommendations().catch((error) => {
          app.log.error(error, "Scheduled AI recommendations refresh failed");
        });
      }, AI_REFRESH_INTERVAL_SEC * 1000);
    }, 2 * 60 * 1000); // 2-minute initial delay
  } else {
    app.log.info("Scheduled AI recommendations refresh disabled because AI_REFRESH_INTERVAL_SEC is set to 0");
  }

  await app.listen({ port, host: "0.0.0.0" });
};

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Shutting down API service");

  try {
    await app.close();
    await prisma.$disconnect();
    app.log.info("API service shutdown complete");
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Error during API shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

start().catch(async (error) => {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
