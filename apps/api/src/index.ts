import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import { ItemType, ListItemType, ListKind, Prisma, PrismaClient } from "@prisma/client";
import { TraktClient } from "./trakt.js";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });
let traktClient: TraktClient | null = null;

const getTraktClient = () => {
  if (!traktClient) {
    traktClient = new TraktClient();
  }

  return traktClient;
};

const API_TOKEN = process.env.API_TOKEN;
const TRAKT_LAST_POLLED_AT_KEY = "trakt:lastPolledAt";
const TRAKT_POLL_INTERVAL_SEC = Number(process.env.TRAKT_POLL_INTERVAL_SEC ?? 300);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuthenticatedRequest = FastifyRequest;
type StremioMetaType = "movie" | "series";
type StremioMetaPreview = {
  id: string;
  type: StremioMetaType;
  name: string;
};

const DEFAULT_STREMIO_LIMIT = 50;
const MAX_STREMIO_LIMIT = 200;

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

const buildMetasFromIds = async (ids: string[], type: StremioMetaType): Promise<StremioMetaPreview[]> => {
  if (ids.length === 0) {
    return [];
  }

  const itemType = type === "movie" ? ItemType.movie : ItemType.series;
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

  const titleByImdbId = new Map(items.map((item) => [item.imdbId, item.title?.trim() ?? ""]));

  return ids.map((id) => ({
    id,
    type,
    name: titleByImdbId.get(id) || id
  }));
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
  const client = getTraktClient();
  const pollStartAt = await getTraktPollStartAt();
  const pollCompletedAt = new Date();
  const pollStartAtIso = pollStartAt.toISOString();

  const [movieHistory, episodeHistory] = await Promise.all([
    client.fetchMovieHistory(logger, pollStartAtIso),
    client.fetchEpisodeHistory(logger, pollStartAtIso)
  ]);

  const importedWatchEvents = { movies: 0, episodes: 0 };
  const seriesProgressByImdb = new Map<string, { lastSeason: number; lastEpisode: number; updatedAt: Date }>();

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
      watchedAtDate.getTime() > existing.updatedAt.getTime() ||
      (watchedAtDate.getTime() === existing.updatedAt.getTime() &&
        (season > existing.lastSeason || (season === existing.lastSeason && episode > existing.lastEpisode)))
    ) {
      seriesProgressByImdb.set(seriesImdbId, {
        lastSeason: season,
        lastEpisode: episode,
        updatedAt: watchedAtDate
      });
    }

    importedWatchEvents.episodes += 1;
  }

  for (const [seriesImdbId, progress] of seriesProgressByImdb.entries()) {
    await prisma.seriesProgress.upsert({
      where: { seriesImdbId },
      create: {
        seriesImdbId,
        lastSeason: progress.lastSeason,
        lastEpisode: progress.lastEpisode,
        updatedAt: progress.updatedAt
      },
      update: {
        lastSeason: progress.lastSeason,
        lastEpisode: progress.lastEpisode,
        updatedAt: progress.updatedAt
      }
    });
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

app.post<{ Body: unknown }>("/lists", { preHandler: verifyToken }, async (request, reply) => {
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

app.get("/lists", { preHandler: verifyToken }, async () => {
  const lists = await prisma.list.findMany({
    orderBy: [{ createdAt: "asc" }],
    include: { items: { orderBy: { addedAt: "asc" } } }
  });

  return { lists };
});

app.get<{ Querystring: { limit?: string } }>("/stremio/catalog/my_watchlist_movies", { preHandler: verifyToken }, async (request) => {
  const limit = parseCatalogLimit(request.query.limit);
  const watchlist = await getDefaultWatchlist();

  const watchlistItems = await prisma.listItem.findMany({
    where: { listId: watchlist.id, type: ListItemType.movie },
    orderBy: { addedAt: "desc" },
    take: limit,
    select: { imdbId: true }
  });

  const metas = await buildMetasFromIds(
    watchlistItems.map((item) => item.imdbId),
    "movie"
  );

  return { metas };
});

app.get<{ Querystring: { limit?: string } }>("/stremio/catalog/my_watchlist_series", { preHandler: verifyToken }, async (request) => {
  const limit = parseCatalogLimit(request.query.limit);
  const watchlist = await getDefaultWatchlist();

  const watchlistItems = await prisma.listItem.findMany({
    where: { listId: watchlist.id, type: ListItemType.series },
    orderBy: { addedAt: "desc" },
    take: limit,
    select: { imdbId: true }
  });

  const metas = await buildMetasFromIds(
    watchlistItems.map((item) => item.imdbId),
    "series"
  );

  return { metas };
});

app.get<{ Querystring: { limit?: string } }>("/stremio/catalog/my_recent_movies", { preHandler: verifyToken }, async (request) => {
  const limit = parseCatalogLimit(request.query.limit);

  const groupedMovies = await prisma.watchEvent.groupBy({
    by: ["imdbId"],
    where: { type: "movie" },
    _max: { watchedAt: true },
    orderBy: { _max: { watchedAt: "desc" } },
    take: limit
  });

  const metas = await buildMetasFromIds(
    groupedMovies.map((event) => event.imdbId),
    "movie"
  );

  return { metas };
});

app.get<{ Querystring: { limit?: string } }>("/stremio/catalog/my_continue_series", { preHandler: verifyToken }, async (request) => {
  const limit = parseCatalogLimit(request.query.limit);

  const seriesProgress = await prisma.seriesProgress.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { seriesImdbId: true }
  });

  const metas = await buildMetasFromIds(
    seriesProgress.map((progress) => progress.seriesImdbId),
    "series"
  );

  return { metas };
});

app.post<{ Params: { listId: string }; Body: unknown }>("/lists/:listId/items", { preHandler: verifyToken }, async (request, reply) => {
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

  await prisma.item.upsert({
    where: { type_imdbId: { type: itemType, imdbId } },
    create: {
      type: itemType,
      imdbId,
      title: body.title?.trim() ? body.title.trim() : undefined
    },
    update: body.title?.trim() ? { title: body.title.trim() } : {}
  });

  const listItem = await prisma.listItem.upsert({
    where: {
      listId_type_imdbId: {
        listId: request.params.listId,
        type,
        imdbId
      }
    },
    create: {
      listId: request.params.listId,
      type,
      imdbId
    },
    update: {}
  });

  return reply.code(201).send({ listItem });
});

app.delete<{ Params: { listId: string; type: string; imdbId: string } }>("/lists/:listId/items/:type/:imdbId", { preHandler: verifyToken }, async (request, reply) => {
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

app.post("/trakt/import", { preHandler: verifyToken }, async (request, reply) => {
  let client: TraktClient;
  try {
    client = getTraktClient();
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
  const seriesProgressByImdb = new Map<string, { lastSeason: number; lastEpisode: number; updatedAt: Date }>();

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
      watchedAtDate.getTime() > existing.updatedAt.getTime() ||
      (watchedAtDate.getTime() === existing.updatedAt.getTime() &&
        (season > existing.lastSeason || (season === existing.lastSeason && episode > existing.lastEpisode)))
    ) {
      seriesProgressByImdb.set(seriesImdbId, {
        lastSeason: season,
        lastEpisode: episode,
        updatedAt: watchedAtDate
      });
    }

    importedWatchEvents.episodes += 1;
  }

  for (const [seriesImdbId, progress] of seriesProgressByImdb.entries()) {
    await prisma.seriesProgress.upsert({
      where: { seriesImdbId },
      create: {
        seriesImdbId,
        lastSeason: progress.lastSeason,
        lastEpisode: progress.lastEpisode,
        updatedAt: progress.updatedAt
      },
      update: {
        lastSeason: progress.lastSeason,
        lastEpisode: progress.lastEpisode,
        updatedAt: progress.updatedAt
      }
    });
  }

  return reply.code(200).send({
    importedWatchlist,
    importedWatchEvents,
    updatedSeriesProgress: seriesProgressByImdb.size
  });
});

app.post("/trakt/poll", { preHandler: verifyToken }, async (request, reply) => {
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
