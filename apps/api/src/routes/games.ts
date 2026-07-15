import { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { resolveProfile } from "../lib/profile.js";
import { getIgdb } from "../lib/igdb-client.js";
import { UUID_V4_PATTERN } from "../lib/types.js";

type GameSort = "recent" | "playtime" | "rating";

const isValidSort = (value: unknown): value is GameSort =>
  value === "recent" || value === "playtime" || value === "rating";

const sortToOrderBy = (sort: GameSort): Prisma.GameOrderByWithRelationInput[] => {
  switch (sort) {
    case "playtime":
      return [{ playtimeMinutes: "desc" }, { createdAt: "desc" }];
    case "rating":
      return [{ rating: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
    case "recent":
    default:
      return [{ lastPlayedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
  }
};

const gamesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  app.get<{ Querystring: { sort?: string } }>("/games", async (request, reply) => {
    const sort = request.query.sort ?? "recent";
    if (!isValidSort(sort)) {
      return reply.code(400).send({ error: "sort must be one of: recent, playtime, rating" });
    }

    const games = await prisma.game.findMany({
      where: { profileId: request.profileId! },
      orderBy: sortToOrderBy(sort)
    });

    return { games };
  });

  app.get<{ Querystring: { q?: string } }>("/games/search", async (request, reply) => {
    const query = request.query.q?.trim();
    if (!query) {
      return reply.code(400).send({ error: "q is required" });
    }

    let results: Awaited<ReturnType<ReturnType<typeof getIgdb>["searchGames"]>>;
    try {
      results = await getIgdb().searchGames(query);
    } catch (error) {
      request.log.error(error, "IGDB client initialization failed");
      return reply.code(500).send({ error: "IGDB integration is not configured" });
    }

    const existing = await prisma.game.findMany({
      where: { profileId: request.profileId!, igdbId: { in: results.map((r) => r.igdbId) } },
      select: { igdbId: true }
    });
    const existingIds = new Set(existing.map((g) => g.igdbId));

    return { results: results.map((r) => ({ ...r, inLibrary: existingIds.has(r.igdbId) })) };
  });

  app.post<{ Body: unknown }>("/games", async (request, reply) => {
    const body = request.body as
      | { igdbId?: unknown; title?: unknown; coverUrl?: unknown; releaseDate?: unknown; genres?: unknown }
      | null;
    if (!body) return reply.code(400).send({ error: "igdbId and title are required" });

    if (!Number.isInteger(body.igdbId)) {
      return reply.code(400).send({ error: "igdbId is required" });
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return reply.code(400).send({ error: "title is required" });
    }
    if (body.coverUrl !== undefined && body.coverUrl !== null && typeof body.coverUrl !== "string") {
      return reply.code(400).send({ error: "coverUrl must be a string when provided" });
    }
    if (body.genres !== undefined && !(Array.isArray(body.genres) && body.genres.every((g) => typeof g === "string"))) {
      return reply.code(400).send({ error: "genres must be an array of strings when provided" });
    }

    let releaseDate: Date | null = null;
    if (body.releaseDate !== undefined && body.releaseDate !== null) {
      if (typeof body.releaseDate !== "string" || Number.isNaN(new Date(body.releaseDate).getTime())) {
        return reply.code(400).send({ error: "releaseDate must be a valid date string when provided" });
      }
      releaseDate = new Date(body.releaseDate);
    }

    try {
      const game = await prisma.game.create({
        data: {
          profileId: request.profileId!,
          igdbId: body.igdbId as number,
          title: (body.title as string).trim(),
          coverUrl: (body.coverUrl as string | null | undefined) ?? null,
          releaseDate,
          genres: (body.genres as string[] | undefined) ?? []
        }
      });

      return reply.code(201).send({ game });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ error: "This game is already in your library" });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/games/:id", async (request, reply) => {
    if (!UUID_V4_PATTERN.test(request.params.id)) {
      return reply.code(400).send({ error: "id must be a valid UUID" });
    }

    const game = await prisma.game.findFirst({ where: { id: request.params.id, profileId: request.profileId! } });
    if (!game) return reply.code(404).send({ error: "Game not found" });

    const body = request.body as
      | { rating?: unknown; notes?: unknown; finished?: unknown; finishedAt?: unknown }
      | null;
    if (!body || typeof body !== "object") {
      return reply.code(400).send({ error: "Body is required" });
    }

    const data: Prisma.GameUpdateInput = {};

    if ("rating" in body) {
      if (body.rating !== null && !(typeof body.rating === "number" && body.rating >= 1 && body.rating <= 10)) {
        return reply.code(400).send({ error: "rating must be a number between 1 and 10, or null to clear it" });
      }
      data.rating = body.rating;
    }

    if ("notes" in body) {
      if (body.notes !== null && typeof body.notes !== "string") {
        return reply.code(400).send({ error: "notes must be a string, or null to clear it" });
      }
      data.notes = body.notes;
    }

    if ("finishedAt" in body) {
      if (body.finishedAt !== null && (typeof body.finishedAt !== "string" || Number.isNaN(new Date(body.finishedAt).getTime()))) {
        return reply.code(400).send({ error: "finishedAt must be a valid date string, or null to clear it" });
      }
      data.finishedAt = body.finishedAt === null ? null : new Date(body.finishedAt);
    }

    if ("finished" in body) {
      if (typeof body.finished !== "boolean") {
        return reply.code(400).send({ error: "finished must be a boolean" });
      }
      data.finished = body.finished;

      // Stamp today's date when marking finished unless the caller already
      // provided one; clear it when un-marking unless the caller wants to
      // keep a specific date around.
      if (!("finishedAt" in body)) {
        data.finishedAt = body.finished ? (game.finishedAt ?? new Date()) : null;
      }
    }

    const updated = await prisma.game.update({ where: { id: game.id }, data });
    return { game: updated };
  });

  app.delete<{ Params: { id: string } }>("/games/:id", async (request, reply) => {
    if (!UUID_V4_PATTERN.test(request.params.id)) {
      return reply.code(400).send({ error: "id must be a valid UUID" });
    }

    const game = await prisma.game.findFirst({ where: { id: request.params.id, profileId: request.profileId! } });
    if (!game) return reply.code(404).send({ error: "Game not found" });

    await prisma.game.delete({ where: { id: game.id } });
    return reply.code(204).send();
  });
};

export default gamesRoutes;
