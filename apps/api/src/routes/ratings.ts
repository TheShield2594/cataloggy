import { MetadataType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { resolveProfile } from "../lib/profile.js";

const ratingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  app.post<{ Body: unknown }>("/ratings", async (request, reply) => {
    const body = request.body as { imdbId?: unknown; type?: unknown; rating?: unknown } | null;
    if (!body) return reply.code(400).send({ error: "Body is required" });

    const imdbId = typeof body.imdbId === "string" ? body.imdbId.trim() : "";
    if (!imdbId) return reply.code(400).send({ error: "imdbId is required" });

    const rawType = typeof body.type === "string" ? body.type : "";
    if (rawType !== "movie" && rawType !== "series") {
      return reply.code(400).send({ error: "type must be one of: movie, series" });
    }
    const type = rawType as MetadataType;

    const rating =
      typeof body.rating === "number" && Number.isFinite(body.rating) ? body.rating : null;
    if (rating === null || rating < 1 || rating > 10) {
      return reply.code(400).send({ error: "rating must be a number between 1 and 10" });
    }

    const roundedRating = Math.round(rating * 10) / 10;
    const profileId = request.profileId!;
    const ratedAt = new Date();
    const row = await prisma.rating.upsert({
      where: { profileId_type_imdbId: { profileId, type, imdbId } },
      create: { profileId, type, imdbId, rating: roundedRating, ratedAt },
      update: { rating: roundedRating, ratedAt },
    });

    return reply.code(200).send({ rating: toRatingPayload(row) });
  });

  app.get<{ Params: { type: string; imdbId: string } }>(
    "/ratings/:type/:imdbId",
    async (request, reply) => {
      const { type, imdbId } = request.params;
      if (type !== "movie" && type !== "series") {
        return reply.code(400).send({ error: "type must be one of: movie, series" });
      }

      const row = await prisma.rating.findUnique({
        where: { profileId_type_imdbId: { profileId: request.profileId!, type, imdbId } },
      });
      if (!row) return reply.code(404).send({ error: "No rating found" });

      return { rating: toRatingPayload(row) };
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
        await prisma.rating.delete({
          where: { profileId_type_imdbId: { profileId: request.profileId!, type, imdbId } },
        });
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

    const rows = await prisma.rating.findMany({
      where: {
        profileId: request.profileId!,
        ...(typeFilter ? { type: typeFilter as MetadataType } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    return { ratings: rows.map(toRatingPayload) };
  });
};

const toRatingPayload = (row: { imdbId: string; type: MetadataType; rating: number; ratedAt: Date }) => ({
  imdbId: row.imdbId,
  type: row.type,
  rating: row.rating,
  ratedAt: row.ratedAt.toISOString(),
});

export default ratingsRoutes;
