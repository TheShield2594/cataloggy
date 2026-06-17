import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";

const ratingsRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: unknown }>("/ratings", async (request, reply) => {
    const body = request.body as { imdbId?: unknown; type?: unknown; rating?: unknown } | null;
    if (!body) return reply.code(400).send({ error: "Body is required" });

    const imdbId = typeof body.imdbId === "string" ? body.imdbId.trim() : "";
    if (!imdbId) return reply.code(400).send({ error: "imdbId is required" });

    const rawType = typeof body.type === "string" ? body.type : "";
    if (rawType !== "movie" && rawType !== "series") {
      return reply.code(400).send({ error: "type must be one of: movie, series" });
    }

    const rating =
      typeof body.rating === "number" && Number.isFinite(body.rating) ? body.rating : null;
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

  app.get<{ Params: { type: string; imdbId: string } }>(
    "/ratings/:type/:imdbId",
    async (request, reply) => {
      const { type, imdbId } = request.params;
      if (type !== "movie" && type !== "series") {
        return reply.code(400).send({ error: "type must be one of: movie, series" });
      }

      const row = await prisma.kV.findUnique({ where: { key: `rating:${type}:${imdbId}` } });
      if (!row) return reply.code(404).send({ error: "No rating found" });

      return { rating: JSON.parse(row.value) };
    }
  );

  app.delete<{ Params: { type: string; imdbId: string } }>(
    "/ratings/:type/:imdbId",
    async (request, reply) => {
      const { type, imdbId } = request.params;
      if (type !== "movie" && type !== "series") {
        return reply.code(400).send({ error: "type must be one of: movie, series" });
      }

      try {
        await prisma.kV.delete({ where: { key: `rating:${type}:${imdbId}` } });
      } catch { /* not found is fine */ }

      return reply.code(204).send();
    }
  );

  app.get<{ Querystring: { type?: string; limit?: string } }>("/ratings", async (request, reply) => {
    const typeFilter = request.query.type;
    if (typeFilter && typeFilter !== "movie" && typeFilter !== "series") {
      return reply.code(400).send({ error: "type must be one of: movie, series" });
    }
    const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);

    const prefix = typeFilter ? `rating:${typeFilter}:` : "rating:";
    const rows = await prisma.kV.findMany({
      where: { key: { startsWith: prefix } },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    const ratings = rows.flatMap((r) => {
      try {
        return [JSON.parse(r.value)];
      } catch {
        return [];
      }
    });
    return { ratings };
  });
};

export default ratingsRoutes;
