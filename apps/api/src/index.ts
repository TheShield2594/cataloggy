import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import { ItemType, ListItemType, ListKind, MetadataType, Prisma, PrismaClient, WatchEventType } from "@prisma/client";
import { TraktClient, computeTokenExpiresAt } from "./trakt.js";
import { MetadataPayload, STREAMING_PROVIDERS, TmdbClient } from "./tmdb.js";

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
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
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

  if (!isAllowedOrigin(origin)) {
    return;
  }

  reply.header("Access-Control-Allow-Origin", IS_DEVELOPMENT ? "*" : origin!);
  reply.header("Access-Control-Allow-Methods", CORS_METHODS);
  reply.header("Access-Control-Allow-Headers", CORS_HEADERS);

  if (!IS_DEVELOPMENT) {
    reply.header("Vary", "Origin");
  }
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
  const isDetailedPayload = metadata.totalSeasons !== null || metadata.totalEpisodes !== null;

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
  return metadata;
};

const METADATA_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

const syncMetadata = async (imdbId: string, type: MetadataType) => {
  const existing = await prisma.metadata.findUnique({
    where: { imdbId_type: { imdbId, type } }
  });

  if (existing && Date.now() - existing.updatedAt.getTime() < METADATA_FRESHNESS_MS) {
    return existing;
  }

  const tmdb = await getTmdb();
  const payload = await tmdb.findByImdbId(type, imdbId);

  if (!payload) {
    return existing ?? null;
  }

  return upsertMetadata(payload);
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
  const items = await prisma.item.findMany({
    where: {
      type: itemType,
      imdbId: { in: ids }
    },
    select: {
      imdbId: true,
      title: true
    }
  });
  const metadata = await prisma.metadata.findMany({
    where: {
      imdbId: { in: ids },
      type: metadataType
    },
    select: {
      imdbId: true,
      name: true,
      poster: true,
      year: true,
      description: true,
      genres: true,
      rating: true,
    }
  });

  const titleByImdbId = new Map(items.map((item) => [item.imdbId, item.title?.trim() ?? ""]));
  const metadataByImdbId = new Map(metadata.map((entry) => [entry.imdbId, entry]));

  return ids.map((id) => {
    const meta = metadataByImdbId.get(id);

    return {
      id,
      type,
      name: titleByImdbId.get(id) || meta?.name || id,
      poster: meta?.poster ?? undefined,
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

  const listItems = await prisma.listItem.findMany({
    where: { imdbId: { in: imdbIds }, type: { in: resultTypes } },
    include: { list: { select: { id: true, name: true, kind: true } } }
  });

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
      poster: result.poster,
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

  const existing = await prisma.metadata.findUnique({
    where: {
      imdbId_type: {
        imdbId,
        type
      }
    }
  });

  if (existing) {
    return existing;
  }

  try {
    const metadata = await fetchMetadata(type, imdbId);
    if (!metadata) {
      return reply.code(404).send({ error: "Metadata not found" });
    }

    return metadata;
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

// ─── Trending / Popular (TMDB) ───

type TrendingCacheEntry = { data: StremioMetaPreview[]; expiry: number };
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
  const cached = trendingCacheGet(cacheKey);
  if (cached && now < cached.expiry) return { metas: cached.data };

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
    return { metas };
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
  const cached = trendingCacheGet(cacheKey);
  if (cached && now < cached.expiry) return { metas: cached.data };

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
    return { metas };
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
  const cached = trendingCacheGet(cacheKey);
  if (cached && now < cached.expiry) return { metas: cached.data };

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
    return { metas };
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

  return { metas: allRecs.slice(0, limit) };
});

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
  const cached = trendingCacheGet(cacheKey);
  if (cached && now < cached.expiry) return { metas: cached.data, provider: provider.name };

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
    return { metas, provider: provider.name };
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
  const cached = trendingCacheGet(cacheKey);
  if (cached && now < cached.expiry) return { metas: cached.data };

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
    return { metas };
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

  const progress = progressRows.map((row) => {
    const meta = metaByImdbId.get(row.seriesImdbId);
    return {
      imdbId: row.seriesImdbId,
      seriesImdbId: row.seriesImdbId,
      lastSeason: row.lastSeason,
      lastEpisode: row.lastEpisode,
      lastWatchedAt: row.lastWatchedAt,
      updatedAt: row.updatedAt,
      name: meta?.name ?? null,
      poster: meta?.poster ?? null,
      totalSeasons: meta?.totalSeasons ?? null,
      totalEpisodes: meta?.totalEpisodes ?? null,
      watchedEpisodes: watchedBySeriesId.get(row.seriesImdbId) ?? null,
    };
  });

  return { progress };
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
    const valid = migrated.filter((c) => ALL_ADDON_CATALOGS.includes(c));
    return { enabledCatalogs: valid.length > 0 ? valid : DEFAULT_ADDON_CATALOGS };
  } catch {
    return { enabledCatalogs: DEFAULT_ADDON_CATALOGS };
  }
};

app.get("/addon/config", async () => {
  const config = await getAddonConfig();
  return { config, availableCatalogs: ALL_ADDON_CATALOGS };
});

app.post<{ Body: unknown }>("/addon/config", async (request, reply) => {
  const body = request.body as { enabledCatalogs?: unknown } | null;
  if (!body || !Array.isArray(body.enabledCatalogs)) {
    return reply.code(400).send({ error: "enabledCatalogs must be an array of strings" });
  }
  const enabled = (body.enabledCatalogs as unknown[]).filter(
    (c): c is string => typeof c === "string" && ALL_ADDON_CATALOGS.includes(c)
  );
  const config: AddonConfig = { enabledCatalogs: enabled };
  await prisma.kV.upsert({
    where: { key: ADDON_CONFIG_KEY },
    create: { key: ADDON_CONFIG_KEY, value: JSON.stringify(config), updatedAt: new Date() },
    update: { value: JSON.stringify(config), updatedAt: new Date() }
  });
  return { config };
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

  const [watchedMovies, watchedShows] = await Promise.all([
    client.fetchWatchedMovies(request.log),
    client.fetchWatchedShows(request.log)
  ]);

  const imported = { movies: 0, episodes: 0 };
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
  let refreshed = 0;

  for (let i = 0; i < allMetadata.length; i += BATCH_SIZE) {
    const batch = allMetadata.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        const payload = await tmdb.findByImdbId(item.type, item.imdbId);
        if (payload) {
          await upsertMetadata(payload);
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

app.post("/trakt/poll", async (request, reply) => {
  try {
    const result = await pollTraktHistory(request.log);
    return reply.code(200).send(result);
  } catch (error) {
    request.log.error(error, "Trakt poll failed");
    return reply.code(500).send({ error: "Trakt poll failed" });
  }
});

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
