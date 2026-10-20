import { WatchEventType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { resolveProfile } from "../lib/profile.js";
import { resolvePlaybackTarget, savePlaybackProgress } from "../lib/playback.js";
import { MAX_EPISODE, MAX_SEASON } from "../lib/import-validation.js";
import { MAX_IMDB_ID_LENGTH, NON_BLANK, nullable } from "../lib/request-schema.js";
import { UUID_V4_PATTERN } from "../lib/types.js";

/**
 * Resume points for players — the "continue from 42:10" half of watch tracking,
 * shaped after Trakt's /sync/playback.
 *
 * A player saves where it stopped with `PUT /playback` (or lets
 * `/scrobble/pause` and `/scrobble/stop` do it), asks for it back with
 * `GET /playback/:imdbId` before starting, and the point is cleared by itself
 * once the title is recorded as watched. Marking something watched stays
 * `POST /watch`; nothing here writes history.
 */

/** Twelve hours: longer than anything a player will report, finite so it cannot overflow an INTEGER column. */
const MAX_PLAYBACK_SECONDS = 12 * 60 * 60;

const savePlaybackBodySchema = {
  type: "object",
  required: ["type", "imdbId"],
  properties: {
    type: { type: "string", enum: [WatchEventType.movie, WatchEventType.episode] },
    imdbId: { type: "string", pattern: NON_BLANK, maxLength: MAX_IMDB_ID_LENGTH },
    seriesImdbId: nullable({ pattern: NON_BLANK, maxLength: MAX_IMDB_ID_LENGTH }, "string"),
    season: nullable({ minimum: 0, maximum: MAX_SEASON }, "integer"),
    episode: nullable({ minimum: 0, maximum: MAX_EPISODE }, "integer"),
    progress: nullable({ minimum: 0, maximum: 100 }, "number"),
    positionSeconds: nullable({ minimum: 0, maximum: MAX_PLAYBACK_SECONDS }, "integer"),
    durationSeconds: nullable({ minimum: 1, maximum: MAX_PLAYBACK_SECONDS }, "integer"),
  },
} as const;

type SavePlaybackBody = {
  type: WatchEventType;
  imdbId: string;
  seriesImdbId?: string | null;
  season?: number | null;
  episode?: number | null;
  progress?: number | null;
  positionSeconds?: number | null;
  durationSeconds?: number | null;
};

type PlaybackRow = {
  id: string;
  type: WatchEventType;
  imdbId: string;
  season: number | null;
  episode: number | null;
  progress: number;
  positionSeconds: number | null;
  durationSeconds: number | null;
  pausedAt: Date;
};

const toPlaybackData = (row: PlaybackRow, meta?: { name: string | null; poster: string | null }) => ({
  id: row.id,
  type: row.type,
  imdbId: row.imdbId,
  season: row.season,
  episode: row.episode,
  progress: row.progress,
  positionSeconds: row.positionSeconds,
  durationSeconds: row.durationSeconds,
  pausedAt: row.pausedAt.toISOString(),
  ...(meta ? { name: meta.name, poster: meta.poster } : {}),
});

/** A non-negative integer from a query string, `undefined` when absent, `null` when malformed. */
const parseQueryInt = (value: string | undefined): number | null | undefined => {
  if (value === undefined || value === "") return undefined;
  return /^\d+$/.test(value) ? Number(value) : null;
};

const playbackRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  app.get<{ Querystring: { type?: string; limit?: string } }>("/playback", async (request, reply) => {
    const { type } = request.query;
    if (type !== undefined && type !== WatchEventType.movie && type !== WatchEventType.episode) {
      return reply.code(400).send({ error: "type must be one of: movie, episode" });
    }
    const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);

    const rows = await prisma.playbackProgress.findMany({
      where: { profileId: request.profileId!, ...(type ? { type } : {}) },
      orderBy: { pausedAt: "desc" },
      take: limit,
    });
    if (rows.length === 0) return { playback: [] };

    // Episodes are stored against the series, so one lookup covers both.
    const metadata = await prisma.metadata.findMany({
      where: { imdbId: { in: [...new Set(rows.map((row) => row.imdbId))] } },
      select: { imdbId: true, name: true, poster: true },
    });
    const metaByImdbId = new Map(metadata.map((m) => [m.imdbId, m]));

    return {
      playback: rows.map((row) => {
        const meta = metaByImdbId.get(row.imdbId);
        return toPlaybackData(row, { name: meta?.name ?? null, poster: meta?.poster ?? null });
      }),
    };
  });

  /**
   * The resume point for one title, or `{ playback: null }`. An episode is the
   * series id plus `season` and `episode`; without both it is the film.
   */
  app.get<{ Params: { imdbId: string }; Querystring: { season?: string; episode?: string } }>(
    "/playback/:imdbId",
    async (request, reply) => {
      const imdbId = request.params.imdbId.trim();
      if (!imdbId || imdbId.length > MAX_IMDB_ID_LENGTH) {
        return reply.code(400).send({ error: "imdbId is required" });
      }
      const season = parseQueryInt(request.query.season);
      const episode = parseQueryInt(request.query.episode);
      if (season === null || episode === null) {
        return reply.code(400).send({ error: "season and episode must be non-negative integers" });
      }
      if ((season === undefined) !== (episode === undefined)) {
        return reply.code(400).send({ error: "season and episode must be given together" });
      }

      const target = resolvePlaybackTarget(
        season === undefined
          ? { type: WatchEventType.movie, imdbId }
          : { type: WatchEventType.episode, imdbId, season, episode }
      )!;
      const row = await prisma.playbackProgress.findUnique({
        where: { profileId_key: { profileId: request.profileId!, key: target.key } },
      });
      return { playback: row ? toPlaybackData(row) : null };
    }
  );

  app.put<{ Body: SavePlaybackBody }>(
    "/playback",
    { schema: { body: savePlaybackBodySchema } },
    async (request, reply) => {
      const { type, imdbId, seriesImdbId, season, episode, progress, positionSeconds, durationSeconds } =
        request.body;

      if (type === WatchEventType.episode && (season == null || episode == null)) {
        return reply.code(400).send({ error: "season and episode are required for an episode" });
      }
      if (progress == null && (positionSeconds == null || durationSeconds == null)) {
        return reply.code(400).send({ error: "progress, or positionSeconds with durationSeconds, is required" });
      }
      if (positionSeconds != null && durationSeconds != null && positionSeconds > durationSeconds) {
        return reply.code(400).send({ error: "positionSeconds cannot be past durationSeconds" });
      }

      const row = await savePlaybackProgress(
        request.profileId!,
        { type, imdbId: imdbId.trim(), seriesImdbId: seriesImdbId?.trim() || null, season, episode },
        { progress, positionSeconds, durationSeconds }
      );
      // Both cases that make the helper return null were rejected above.
      return { playback: toPlaybackData(row!) };
    }
  );

  // Takes the row id from the list, as Trakt's DELETE /sync/playback/:id does.
  app.delete<{ Params: { id: string } }>("/playback/:id", async (request, reply) => {
    const { id } = request.params;
    if (!UUID_V4_PATTERN.test(id)) {
      return reply.code(400).send({ error: "id must be a valid UUID" });
    }
    const { count } = await prisma.playbackProgress.deleteMany({ where: { id, profileId: request.profileId! } });
    if (count === 0) return reply.code(404).send({ error: "Playback progress not found" });
    return reply.code(204).send();
  });
};

export default playbackRoutes;
