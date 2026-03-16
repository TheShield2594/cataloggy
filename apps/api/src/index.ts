import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import { ItemType, ListItemType, ListKind, MetadataType, Prisma, PrismaClient } from "@prisma/client";
import { TraktClient } from "./trakt.js";
import { MetadataPayload, TmdbClient } from "./tmdb.js";

const prisma = new PrismaClient();

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

  if (url === "/health" || url.startsWith("/addon/") || url === "/addon") {
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

const upsertMetadata = async (metadata: MetadataPayload) =>
  prisma.metadata.upsert({
    where: {
      imdbId_type: {
        imdbId: metadata.imdbId,
        type: metadata.type
      }
    },
    create: metadata,
    update: {
      tmdbId: metadata.tmdbId,
      name: metadata.name,
      year: metadata.year,
      poster: metadata.poster,
      background: metadata.background,
      description: metadata.description,
      updatedAt: new Date()
    }
  });

const fetchMetadata = async (type: MetadataType, imdbId: string): Promise<MetadataPayload | null> => {
  const tmdb = TmdbClient.fromEnv();
  const metadata = await tmdb.findByImdbId(type, imdbId);

  if (!metadata) {
    return null;
  }

  await upsertMetadata(metadata);
  return metadata;
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
      description: true
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
      description: meta?.description ?? undefined
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


app.get<{ Querystring: { type?: string; query?: string } }>("/search", async (request, reply) => {
  const type = getMetadataType(request.query.type ?? "");
  if (!type) {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  const query = request.query.query?.trim();
  if (!query) {
    return reply.code(400).send({ error: "query is required" });
  }

  let tmdb: TmdbClient;
  try {
    tmdb = TmdbClient.fromEnv();
  } catch (error) {
    request.log.error(error, "TMDB client initialization failed");
    return reply.code(500).send({ error: "TMDB integration is not configured" });
  }

  const results = await tmdb.search(type, query);
  await Promise.all(results.map((result) => upsertMetadata(result)));

  return results.map((result) => ({
    tmdbId: result.tmdbId,
    imdbId: result.imdbId,
    type: result.type,
    name: result.name,
    year: result.year,
    poster: result.poster,
    description: result.description
  }));
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

app.get("/health", async () => ({ status: "ok", service: "api" }));

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

  return reply.code(201).send({ list });
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
          title: body.title?.trim() ? body.title.trim() : undefined
        },
        update: body.title?.trim() ? { title: body.title.trim() } : {}
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

  const metadataMap = new Map<string, { name: string; poster: string | null; year: number | null }>();
  if (listItems.length > 0) {
    const metadata = await prisma.metadata.findMany({
      where: {
        OR: listItems.map((item) => ({
          imdbId: item.imdbId,
          type: item.type as unknown as MetadataType
        }))
      },
      select: { imdbId: true, type: true, name: true, poster: true, year: true }
    });

    for (const m of metadata) {
      metadataMap.set(`${m.imdbId}:${m.type}`, { name: m.name, poster: m.poster, year: m.year });
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

app.post("/trakt/import", async (request, reply) => {
  let client: TraktClient;
  try {
    client = await getTraktClient();
  } catch (error) {
    request.log.error(error, "Trakt client initialization failed");
    return reply.code(500).send({ error: "Trakt integration is not configured" });
  }

  const watchlist = await getDefaultWatchlist();

  const [watchlistMovies, watchlistShows, movieHistory, episodeHistory] = await Promise.all([
    client.fetchWatchlistMovies(request.log),
    client.fetchWatchlistShows(request.log),
    client.fetchMovieHistory(request.log),
    client.fetchEpisodeHistory(request.log)
  ]);

  const importedWatchlist = { movies: 0, series: 0 };
  const importedWatchEvents = { movies: 0, episodes: 0 };
  const seriesProgressByImdb = new Map<string, SeriesProgressCandidate>();

  for (const entry of watchlistMovies) {
    const imdbId = entry.movie?.ids?.imdb;
    if (!imdbId) {
      continue;
    }

    const title = entry.movie?.title?.trim();
    await prisma.item.upsert({
      where: { type_imdbId: { type: ItemType.movie, imdbId } },
      create: { type: ItemType.movie, imdbId, title: title || undefined },
      update: title ? { title } : {}
    });

    await prisma.listItem.upsert({
      where: { listId_type_imdbId: { listId: watchlist.id, type: ListItemType.movie, imdbId } },
      create: { listId: watchlist.id, type: ListItemType.movie, imdbId },
      update: {}
    });
    importedWatchlist.movies += 1;
  }

  for (const entry of watchlistShows) {
    const imdbId = entry.show?.ids?.imdb;
    if (!imdbId) {
      continue;
    }

    const title = entry.show?.title?.trim();
    await prisma.item.upsert({
      where: { type_imdbId: { type: ItemType.series, imdbId } },
      create: { type: ItemType.series, imdbId, title: title || undefined },
      update: title ? { title } : {}
    });

    await prisma.listItem.upsert({
      where: { listId_type_imdbId: { listId: watchlist.id, type: ListItemType.series, imdbId } },
      create: { listId: watchlist.id, type: ListItemType.series, imdbId },
      update: {}
    });
    importedWatchlist.series += 1;
  }

  for (const entry of movieHistory) {
    const imdbId = entry.movie?.ids?.imdb;
    const watchedAt = entry.watched_at;

    if (!imdbId || !watchedAt) {
      continue;
    }

    const title = entry.movie?.title?.trim();
    if (title) {
      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.movie, imdbId } },
        create: { type: ItemType.movie, imdbId, title },
        update: { title }
      });
    }

    await prisma.watchEvent.create({
      data: {
        type: "movie",
        imdbId,
        watchedAt: new Date(watchedAt),
        plays: 1
      }
    });

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

    const seriesTitle = entry.show?.title?.trim();
    if (seriesTitle) {
      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.series, imdbId: seriesImdbId } },
        create: { type: ItemType.series, imdbId: seriesImdbId, title: seriesTitle },
        update: { title: seriesTitle }
      });
    }

    await prisma.watchEvent.create({
      data: {
        type: "episode",
        imdbId: episodeImdbId,
        seriesImdbId,
        season,
        episode,
        watchedAt: new Date(watchedAt),
        plays: 1
      }
    });

    const watchedAtDate = new Date(watchedAt);
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

  return reply.code(200).send({
    importedWatchlist,
    importedWatchEvents,
    updatedSeriesProgress: seriesProgressByImdb.size
  });
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
