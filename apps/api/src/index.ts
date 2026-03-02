import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import { ItemType, ListItemType, ListKind, Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const API_TOKEN = process.env.API_TOKEN;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuthenticatedRequest = FastifyRequest;

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

const start = async () => {
  const port = Number(process.env.PORT ?? 7000);
  await ensureDefaultWatchlist();
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
