import { ItemType, ListItemType, ListKind, MetadataType, Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { syncMetadata } from "../lib/metadata.js";
import { UUID_V4_PATTERN } from "../lib/types.js";

const listsRoutes: FastifyPluginAsync = async (app) => {
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
      data: { name: body.name.trim(), kind: body.kind as ListKind },
    });

    return reply.code(201).send({ list: { ...list, itemCount: 0 } });
  });

  app.get("/lists", async () => {
    const lists = await prisma.list.findMany({
      orderBy: [{ createdAt: "asc" }],
      include: { _count: { select: { items: true } } },
    });

    return {
      lists: lists.map((list) => ({
        id: list.id,
        name: list.name,
        kind: list.kind,
        createdAt: list.createdAt,
        itemCount: list._count.items,
      })),
    };
  });

  app.delete<{ Params: { id: string } }>("/lists/:id", async (request, reply) => {
    if (!UUID_V4_PATTERN.test(request.params.id)) {
      return reply.code(400).send({ error: "id must be a valid UUID" });
    }

    const list = await prisma.list.findUnique({ where: { id: request.params.id } });
    if (!list) return reply.code(404).send({ error: "List not found" });

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
    if (!list) return reply.code(404).send({ error: "List not found" });

    const updated = await prisma.list.update({
      where: { id: list.id },
      data: { name: body.name.trim() },
    });

    return { list: updated };
  });

  app.post<{ Params: { listId: string }; Body: unknown }>(
    "/lists/:listId/items",
    async (request, reply) => {
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
      if (!list) return reply.code(404).send({ error: "List not found" });

      const imdbId = (body.imdbId as string).trim();
      const type = body.type as ListItemType;
      const itemType = type as ItemType;

      try {
        const listItem = await prisma.$transaction(async (tx) => {
          await tx.item.upsert({
            where: { type_imdbId: { type: itemType, imdbId } },
            create: {
              type: itemType,
              imdbId,
              title: (body.title as string | undefined)?.trim()
                ? (body.title as string).trim()
                : undefined,
            },
            update: (body.title as string | undefined)?.trim()
              ? { title: (body.title as string).trim() }
              : {},
          });

          return tx.listItem.create({
            data: { listId: request.params.listId, type, imdbId },
          });
        });

        const metadataTypeForSync = itemType === ItemType.movie ? MetadataType.movie : MetadataType.series;
        void syncMetadata(imdbId, metadataTypeForSync).catch((err) =>
          app.log.warn({ imdbId, type: metadataTypeForSync, err }, "Background metadata sync failed")
        );

        return reply.code(201).send({ listItem });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return reply.code(409).send({ error: "Item already exists in this list" });
        }
        throw error;
      }
    }
  );

  app.delete<{ Params: { listId: string; type: string; imdbId: string } }>(
    "/lists/:listId/items/:type/:imdbId",
    async (request, reply) => {
      if (!UUID_V4_PATTERN.test(request.params.listId)) {
        return reply.code(400).send({ error: "listId must be a valid UUID" });
      }

      const type = request.params.type;
      if (!Object.values(ListItemType).includes(type as ListItemType)) {
        return reply.code(400).send({ error: "type must be one of: movie, series" });
      }

      const removed = await prisma.listItem.deleteMany({
        where: {
          listId: request.params.listId,
          type: type as ListItemType,
          imdbId: request.params.imdbId,
        },
      });

      if (removed.count === 0) return reply.code(404).send({ error: "List item not found" });

      return reply.code(204).send();
    }
  );

  app.delete<{ Params: { listId: string; imdbId: string }; Querystring: { type?: string } }>(
    "/lists/:listId/items/:imdbId",
    async (request, reply) => {
      if (!UUID_V4_PATTERN.test(request.params.listId)) {
        return reply.code(400).send({ error: "listId must be a valid UUID" });
      }

      const where: { listId: string; imdbId: string; type?: ListItemType } = {
        listId: request.params.listId,
        imdbId: request.params.imdbId,
      };

      if (request.query.type) {
        if (!Object.values(ListItemType).includes(request.query.type as ListItemType)) {
          return reply.code(400).send({ error: "type must be one of: movie, series" });
        }
        where.type = request.query.type as ListItemType;
      } else {
        const count = await prisma.listItem.count({ where });
        if (count === 0) return reply.code(404).send({ error: "List item not found" });
        if (count > 1) {
          return reply.code(400).send({
            error: "Multiple items match this imdbId; provide ?type=movie or ?type=series to disambiguate",
          });
        }
      }

      const removed = await prisma.listItem.deleteMany({ where });
      if (removed.count === 0) return reply.code(404).send({ error: "List item not found" });

      return reply.code(204).send();
    }
  );

  app.get<{ Params: { listId: string } }>("/lists/:listId/items", async (request, reply) => {
    if (!UUID_V4_PATTERN.test(request.params.listId)) {
      return reply.code(400).send({ error: "listId must be a valid UUID" });
    }

    const list = await prisma.list.findUnique({ where: { id: request.params.listId } });
    if (!list) return reply.code(404).send({ error: "List not found" });

    const listItems = await prisma.listItem.findMany({
      where: { listId: request.params.listId },
      orderBy: { addedAt: "desc" },
    });

    const metadataMap = new Map<
      string,
      { name: string; poster: string | null; year: number | null; genres: string[]; rating: number | null }
    >();

    if (listItems.length > 0) {
      const metadata = await prisma.metadata.findMany({
        where: {
          OR: listItems.map((item) => ({
            imdbId: item.imdbId,
            type: item.type as unknown as MetadataType,
          })),
        },
        select: { imdbId: true, type: true, name: true, poster: true, year: true, genres: true, rating: true },
      });

      for (const m of metadata) {
        metadataMap.set(`${m.imdbId}:${m.type}`, {
          name: m.name,
          poster: m.poster,
          year: m.year,
          genres: m.genres,
          rating: m.rating,
        });
      }
    }

    const items = listItems.map((item) => {
      const meta = metadataMap.get(`${item.imdbId}:${item.type}`);
      return { ...item, metadata: meta ?? null };
    });

    return { items };
  });

  app.get<{ Params: { imdbId: string }; Querystring: { type?: string } }>(
    "/items/:imdbId/lists",
    async (request) => {
      const { imdbId } = request.params;
      const typeFilter = request.query.type;

      const where: { imdbId: string; type?: ListItemType } = { imdbId };
      if (typeFilter && Object.values(ListItemType).includes(typeFilter as ListItemType)) {
        where.type = typeFilter as ListItemType;
      }

      const listItems = await prisma.listItem.findMany({
        where,
        include: { list: { select: { id: true, name: true, kind: true } } },
      });

      return {
        lists: listItems.map((item) => ({
          listId: item.list.id,
          listName: item.list.name,
          listKind: item.list.kind,
          type: item.type,
          addedAt: item.addedAt,
        })),
      };
    }
  );
};

export default listsRoutes;
