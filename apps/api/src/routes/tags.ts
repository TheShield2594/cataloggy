import { ItemType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { resolveProfile } from "../lib/profile.js";

const isValidItemType = (v: unknown): v is ItemType => v === "movie" || v === "series" || v === "episode";

const tagsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  // List all tags for the profile, optionally scoped to a specific item.
  app.get<{ Querystring: { type?: string; imdbId?: string } }>("/tags", async (request, reply) => {
    const profileId = request.profileId!;
    const { type, imdbId } = request.query;

    if (type !== undefined || imdbId !== undefined) {
      if (!isValidItemType(type) || typeof imdbId !== "string" || !imdbId.trim()) {
        return reply.code(400).send({ error: "type and imdbId are required together" });
      }
      const tags = await prisma.tag.findMany({
        where: { profileId, items: { some: { type, imdbId: imdbId.trim() } } },
        orderBy: { name: "asc" },
      });
      return { tags: tags.map(toTagPayload) };
    }

    const tags = await prisma.tag.findMany({
      where: { profileId },
      orderBy: { name: "asc" },
      include: { _count: { select: { items: true } } },
    });
    return { tags: tags.map((t) => ({ ...toTagPayload(t), itemCount: t._count.items })) };
  });

  // Create a tag (or return the existing one with that name).
  app.post<{ Body: unknown }>("/tags", async (request, reply) => {
    const profileId = request.profileId!;
    const body = request.body as { name?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return reply.code(400).send({ error: "name is required" });
    if (name.length > 50) return reply.code(400).send({ error: "name must be 50 characters or fewer" });

    const tag = await prisma.tag.upsert({
      where: { profileId_name: { profileId, name } },
      create: { profileId, name },
      update: {},
    });
    return reply.code(200).send({ tag: toTagPayload(tag) });
  });

  app.delete<{ Params: { tagId: string } }>("/tags/:tagId", async (request, reply) => {
    const profileId = request.profileId!;
    const { tagId } = request.params;
    await prisma.tag.deleteMany({ where: { id: tagId, profileId } });
    return reply.code(204).send();
  });

  // Assign a tag to an item, creating the tag by name if needed.
  app.post<{ Body: unknown }>("/tags/assign", async (request, reply) => {
    const profileId = request.profileId!;
    const body = request.body as { tagName?: unknown; type?: unknown; imdbId?: unknown } | null;
    const tagName = typeof body?.tagName === "string" ? body.tagName.trim() : "";
    const type = body?.type;
    const imdbId = typeof body?.imdbId === "string" ? body.imdbId.trim() : "";

    if (!tagName) return reply.code(400).send({ error: "tagName is required" });
    if (!isValidItemType(type)) return reply.code(400).send({ error: "type must be one of: movie, series, episode" });
    if (!imdbId) return reply.code(400).send({ error: "imdbId is required" });

    const tag = await prisma.tag.upsert({
      where: { profileId_name: { profileId, name: tagName } },
      create: { profileId, name: tagName },
      update: {},
    });

    await prisma.itemTag.upsert({
      where: { tagId_type_imdbId: { tagId: tag.id, type, imdbId } },
      create: { tagId: tag.id, type, imdbId },
      update: {},
    });

    return reply.code(200).send({ tag: toTagPayload(tag) });
  });

  app.delete<{ Body: unknown }>("/tags/assign", async (request, reply) => {
    const profileId = request.profileId!;
    const body = request.body as { tagId?: unknown; type?: unknown; imdbId?: unknown } | null;
    const tagId = typeof body?.tagId === "string" ? body.tagId.trim() : "";
    const type = body?.type;
    const imdbId = typeof body?.imdbId === "string" ? body.imdbId.trim() : "";

    if (!tagId) return reply.code(400).send({ error: "tagId is required" });
    if (!isValidItemType(type)) return reply.code(400).send({ error: "type must be one of: movie, series, episode" });
    if (!imdbId) return reply.code(400).send({ error: "imdbId is required" });

    const tag = await prisma.tag.findFirst({ where: { id: tagId, profileId } });
    if (!tag) return reply.code(404).send({ error: "Tag not found" });

    await prisma.itemTag.deleteMany({ where: { tagId: tag.id, type, imdbId } });
    return reply.code(204).send();
  });
};

const toTagPayload = (tag: { id: string; name: string; createdAt: Date }) => ({
  id: tag.id,
  name: tag.name,
  createdAt: tag.createdAt.toISOString(),
});

export default tagsRoutes;
