import { MetadataType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { resolveProfile } from "../lib/profile.js";
import { MAX_EPISODE, MAX_SEASON } from "../lib/import-validation.js";

const isValidType = (v: unknown): v is MetadataType =>
  v === "movie" || v === "series" || v === "season" || v === "episode";

const TYPE_ERROR = "type must be one of: movie, series, season, episode";

/**
 * Which of the season/episode columns a rating type actually uses. A season
 * rating is located by its season alone; movie and series ratings by neither,
 * and both pin the unused columns to 0 the way the column defaults do.
 *
 * Season 0 is Specials — a real season a self-hoster can rate — which is why
 * `season` is its own type rather than a series rating carrying a season
 * number: (series, 0, 0) is already the key the show's own rating uses.
 */
const locateRating = (type: MetadataType, season: number, episode: number) => ({
  season: type === "season" || type === "episode" ? season : 0,
  episode: type === "episode" ? episode : 0,
});

/**
 * Rejects a season/episode a rating type needs but hasn't been given.
 *
 * Every handler has to run this, not just the writer: reading or deleting
 * `/ratings/season/tt2` with no `season` used to coerce the missing number to
 * 0, which is Specials — so an omitted parameter silently answered with, or
 * deleted, a real rating for a different thing. The bounds are the columns'
 * own, so a number too large to store is a 400 rather than a failed insert.
 */
const invalidLocation = (type: MetadataType, season: unknown, episode: unknown): string | null => {
  const bounded = (value: unknown, max: number) =>
    Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;

  if ((type === "season" || type === "episode") && !bounded(season, MAX_SEASON)) {
    return `season must be an integer between 0 and ${MAX_SEASON} when type is ${type}`;
  }
  if (type === "episode" && !bounded(episode, MAX_EPISODE)) {
    return `episode must be an integer between 0 and ${MAX_EPISODE} when type is episode`;
  }
  return null;
};

/** `?season=2` → `2`; absent or unparseable → `null`, which never validates. */
const numericQuery = (raw: string | undefined): number | null => {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const ratingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  app.post<{ Body: unknown }>("/ratings", async (request, reply) => {
    const body = request.body as
      | { imdbId?: unknown; type?: unknown; rating?: unknown; season?: unknown; episode?: unknown; note?: unknown }
      | null;
    if (!body) return reply.code(400).send({ error: "Body is required" });

    const imdbId = typeof body.imdbId === "string" ? body.imdbId.trim() : "";
    if (!imdbId) return reply.code(400).send({ error: "imdbId is required" });

    if (!isValidType(body.type)) {
      return reply.code(400).send({ error: TYPE_ERROR });
    }
    const type = body.type;

    const locationError = invalidLocation(type, body.season, body.episode);
    if (locationError) return reply.code(400).send({ error: locationError });
    const { season, episode } = locateRating(type, body.season as number, body.episode as number);

    const rating =
      typeof body.rating === "number" && Number.isFinite(body.rating) ? body.rating : null;
    if (rating === null || rating < 1 || rating > 10) {
      return reply.code(400).send({ error: "rating must be a number between 1 and 10" });
    }

    if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
      return reply.code(400).send({ error: "note must be a string when provided" });
    }
    const note = typeof body.note === "string" ? body.note.trim() || null : undefined;

    const roundedRating = Math.round(rating * 10) / 10;
    const profileId = request.profileId!;
    const ratedAt = new Date();
    const row = await prisma.rating.upsert({
      where: { profileId_type_imdbId_season_episode: { profileId, type, imdbId, season, episode } },
      create: { profileId, type, imdbId, season, episode, rating: roundedRating, ratedAt, note: note ?? null },
      update: { rating: roundedRating, ratedAt, ...(note !== undefined ? { note } : {}) },
    });

    return reply.code(200).send({ rating: toRatingPayload(row) });
  });

  app.get<{ Params: { type: string; imdbId: string }; Querystring: { season?: string; episode?: string } }>(
    "/ratings/:type/:imdbId",
    async (request, reply) => {
      const { type, imdbId } = request.params;
      if (!isValidType(type)) {
        return reply.code(400).send({ error: TYPE_ERROR });
      }
      const queriedSeason = numericQuery(request.query.season);
      const queriedEpisode = numericQuery(request.query.episode);
      const locationError = invalidLocation(type, queriedSeason, queriedEpisode);
      if (locationError) return reply.code(400).send({ error: locationError });
      const { season, episode } = locateRating(type, queriedSeason as number, queriedEpisode as number);

      const row = await prisma.rating.findUnique({
        where: {
          profileId_type_imdbId_season_episode: { profileId: request.profileId!, type, imdbId, season, episode },
        },
      });
      if (!row) return reply.code(404).send({ error: "No rating found" });

      return { rating: toRatingPayload(row) };
    }
  );

  app.delete<{ Params: { type: string; imdbId: string }; Querystring: { season?: string; episode?: string } }>(
    "/ratings/:type/:imdbId",
    async (request, reply) => {
      const { type, imdbId } = request.params;
      if (!isValidType(type)) {
        return reply.code(400).send({ error: TYPE_ERROR });
      }
      const queriedSeason = numericQuery(request.query.season);
      const queriedEpisode = numericQuery(request.query.episode);
      const locationError = invalidLocation(type, queriedSeason, queriedEpisode);
      if (locationError) return reply.code(400).send({ error: locationError });
      const { season, episode } = locateRating(type, queriedSeason as number, queriedEpisode as number);

      try {
        await prisma.rating.delete({
          where: {
            profileId_type_imdbId_season_episode: { profileId: request.profileId!, type, imdbId, season, episode },
          },
        });
      } catch { /* not found is fine */ }

      return reply.code(204).send();
    }
  );

  app.get<{ Querystring: { type?: string; limit?: string; imdbId?: string } }>(
    "/ratings",
    async (request, reply) => {
      const typeFilter = request.query.type;
      if (typeFilter && !isValidType(typeFilter)) {
        return reply.code(400).send({ error: TYPE_ERROR });
      }
      const imdbId = request.query.imdbId?.trim();

      const rows = await prisma.rating.findMany({
        where: {
          profileId: request.profileId!,
          ...(typeFilter ? { type: typeFilter as MetadataType } : {}),
          ...(imdbId ? { imdbId } : {}),
        },
        orderBy: { updatedAt: "desc" },
        // Filtering by title returns every rating for it — the series, its
        // seasons and its episodes — because the seasons panel draws them all
        // at once and a `limit` would silently blank the oldest-rated episodes
        // of a long-running show. One title's ratings are bounded by its own
        // episode count; the unfiltered list stays capped.
        ...(imdbId ? {} : { take: Math.min(Math.max(Number(request.query.limit) || 50, 1), 200) }),
      });

      return { ratings: rows.map(toRatingPayload) };
    }
  );
};

const toRatingPayload = (row: {
  imdbId: string;
  type: MetadataType;
  season: number;
  episode: number;
  rating: number;
  note: string | null;
  ratedAt: Date;
}) => ({
  imdbId: row.imdbId,
  type: row.type,
  season: row.type === "season" || row.type === "episode" ? row.season : undefined,
  episode: row.type === "episode" ? row.episode : undefined,
  rating: row.rating,
  note: row.note,
  ratedAt: row.ratedAt.toISOString(),
});

export default ratingsRoutes;
