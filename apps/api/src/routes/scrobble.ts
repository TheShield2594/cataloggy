import { MetadataType, ScrobbleStatus, WatchEventType } from "@prisma/client";
import type { FastifyPluginAsync, FastifyBaseLogger } from "fastify";
import { prisma } from "../lib/prisma.js";
import { recordWatchEvent } from "../lib/watch-event.js";
import { pushTraktScrobble } from "../lib/trakt-client.js";
import { resolveProfile } from "../lib/profile.js";
import type { CheckInData } from "../lib/types.js";

export const SCROBBLE_COMPLETE_THRESHOLD = 80;
export const SCROBBLE_STALE_TTL_MS = 24 * 60 * 60 * 1000;
export const SCROBBLE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export const cleanupStaleSessions = async (logger?: FastifyBaseLogger) => {
  const cutoff = new Date(Date.now() - SCROBBLE_STALE_TTL_MS);
  const { count } = await prisma.scrobbleSession.updateMany({
    where: {
      status: { in: [ScrobbleStatus.playing, ScrobbleStatus.paused] },
      updatedAt: { lt: cutoff },
    },
    data: { status: ScrobbleStatus.stopped },
  });
  if (count > 0) {
    logger?.info(`Cleaned up ${count} stale scrobble sessions`);
  }
};

const toCheckInData = (
  row: {
    type: WatchEventType;
    imdbId: string;
    seriesImdbId: string | null;
    season: number | null;
    episode: number | null;
    name: string;
    poster: string | null;
    startedAt: Date;
    expiresAt: Date | null;
  },
  background?: string | null
): CheckInData => ({
  type: row.type,
  imdbId: row.imdbId,
  seriesImdbId: row.seriesImdbId ?? undefined,
  name: row.name,
  poster: row.poster ?? undefined,
  background: background ?? undefined,
  season: row.season ?? undefined,
  episode: row.episode ?? undefined,
  startedAt: row.startedAt.toISOString(),
  expiresAt: row.expiresAt?.toISOString(),
});

const getCheckInBackground = async (row: { type: WatchEventType; imdbId: string; seriesImdbId: string | null }) => {
  const lookupId = row.type === "episode" && row.seriesImdbId ? row.seriesImdbId : row.imdbId;
  const metaType = row.type === "movie" ? MetadataType.movie : MetadataType.series;
  const meta = await prisma.metadata.findUnique({
    where: { imdbId_type: { imdbId: lookupId, type: metaType } },
    select: { background: true },
  });
  return meta?.background ?? null;
};

const scrobbleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  // ─── Check-in ───

  app.get("/checkin", async (request) => {
    const row = await prisma.checkIn.findUnique({ where: { profileId: request.profileId! } });
    if (!row) return { checkin: null };
    const background = await getCheckInBackground(row).catch(() => null);
    return { checkin: toCheckInData(row, background) };
  });

  app.post<{
    Body: {
      type: "movie" | "episode";
      imdbId: string;
      seriesImdbId?: string;
      name: string;
      poster?: string;
      season?: number;
      episode?: number;
      runtime?: number;
    };
  }>("/checkin", async (request) => {
    const { type, imdbId, seriesImdbId, name, poster, season, episode, runtime } = request.body;
    const startedAt = new Date();
    const expiresAt = runtime ? new Date(Date.now() + runtime * 60 * 1000) : null;
    const profileId = request.profileId!;
    const data = {
      type: type as WatchEventType,
      imdbId,
      seriesImdbId: seriesImdbId ?? null,
      name,
      poster: poster ?? null,
      season: season ?? null,
      episode: episode ?? null,
      startedAt,
      expiresAt,
    };
    const row = await prisma.checkIn.upsert({
      where: { profileId },
      create: { profileId, ...data },
      update: data,
    });
    const background = await getCheckInBackground(row).catch(() => null);
    return { checkin: toCheckInData(row, background) };
  });

  app.delete<{ Querystring: { log?: string } }>("/checkin", async (request, reply) => {
    const profileId = request.profileId!;
    const row = await prisma.checkIn.findUnique({ where: { profileId } });
    if (row && request.query.log === "true") {
      try {
        const checkin = toCheckInData(row);
        const seriesImdbId = checkin.seriesImdbId ?? checkin.imdbId;
        await recordWatchEvent({
          type: checkin.type,
          imdbId: checkin.type === "movie" ? checkin.imdbId : seriesImdbId,
          seriesImdbId: checkin.type === "episode" ? seriesImdbId : undefined,
          season: checkin.type === "episode" ? (checkin.season ?? null) : undefined,
          episode: checkin.type === "episode" ? (checkin.episode ?? null) : undefined,
          watchedAt: new Date(),
          source: "checkin",
          request,
        });
      } catch (error) {
        request.log.warn(error, "Failed to log watch event from check-in");
      }
    }
    await prisma.checkIn.deleteMany({ where: { profileId } });
    return reply.code(204).send();
  });

  // ─── Scrobble ───

  app.post<{ Body: unknown }>("/scrobble/start", async (request, reply) => {
    if (!request.body || typeof request.body !== "object") {
      return reply.code(400).send({ error: "type and imdbId are required" });
    }

    const body = request.body as {
      type?: unknown;
      imdbId?: unknown;
      seriesImdbId?: unknown;
      season?: unknown;
      episode?: unknown;
      progress?: unknown;
    };

    if (!Object.values(WatchEventType).includes(body.type as WatchEventType)) {
      return reply.code(400).send({ error: "type must be one of: movie, episode" });
    }

    if (typeof body.imdbId !== "string" || !body.imdbId.trim()) {
      return reply.code(400).send({ error: "imdbId is required" });
    }

    const type = body.type as WatchEventType;
    const imdbId = (body.imdbId as string).trim();
    const seriesImdbId = typeof body.seriesImdbId === "string" ? body.seriesImdbId.trim() || null : null;
    const season = typeof body.season === "number" && Number.isInteger(body.season) ? body.season : null;
    const episode = typeof body.episode === "number" && Number.isInteger(body.episode) ? body.episode : null;
    const progress = typeof body.progress === "number" ? Math.max(0, Math.min(100, body.progress)) : 0;
    const profileId = request.profileId!;

    const { session, created, wasPlaying } = await prisma.$transaction(async (tx) => {
      const existing = await tx.scrobbleSession.findFirst({
        where: {
          profileId,
          imdbId,
          season,
          episode,
          status: { in: [ScrobbleStatus.playing, ScrobbleStatus.paused] },
        },
      });

      if (existing) {
        const updated = await tx.scrobbleSession.update({
          where: { id: existing.id },
          data: { status: ScrobbleStatus.playing, progress },
        });
        return { session: updated, created: false, wasPlaying: existing.status === ScrobbleStatus.playing };
      }

      const newSession = await tx.scrobbleSession.create({
        data: { type, imdbId, seriesImdbId, season, episode, status: ScrobbleStatus.playing, progress, profileId },
      });
      return { session: newSession, created: true, wasPlaying: false };
    });

    if (!wasPlaying) {
      void pushTraktScrobble("start", { type, imdbId, seriesImdbId, season, episode, progress }, request.log);
    }

    return reply.code(created ? 201 : 200).send({ session });
  });

  app.post<{ Body: unknown }>("/scrobble/pause", async (request, reply) => {
    if (!request.body || typeof request.body !== "object") {
      return reply.code(400).send({ error: "imdbId is required" });
    }

    const body = request.body as { imdbId?: unknown; season?: unknown; episode?: unknown; progress?: unknown };
    if (typeof body.imdbId !== "string" || !body.imdbId.trim()) {
      return reply.code(400).send({ error: "imdbId is required" });
    }

    const imdbId = (body.imdbId as string).trim();
    const season = typeof body.season === "number" ? body.season : null;
    const episode = typeof body.episode === "number" ? body.episode : null;
    const progress =
      typeof body.progress === "number" ? Math.max(0, Math.min(100, body.progress)) : undefined;

    const session = await prisma.scrobbleSession.findFirst({
      where: { profileId: request.profileId!, imdbId, season, episode, status: ScrobbleStatus.playing },
    });

    if (!session) return reply.code(404).send({ error: "No active scrobble session found" });

    const updated = await prisma.scrobbleSession.update({
      where: { id: session.id },
      data: { status: ScrobbleStatus.paused, ...(progress !== undefined ? { progress } : {}) },
    });

    void pushTraktScrobble(
      "pause",
      {
        type: session.type,
        imdbId,
        seriesImdbId: session.seriesImdbId,
        season,
        episode,
        progress: updated.progress,
      },
      request.log
    );

    return reply.code(200).send({ session: updated });
  });

  app.post<{ Body: unknown }>("/scrobble/stop", async (request, reply) => {
    if (!request.body || typeof request.body !== "object") {
      return reply.code(400).send({ error: "imdbId is required" });
    }

    const body = request.body as { imdbId?: unknown; season?: unknown; episode?: unknown; progress?: unknown };
    if (typeof body.imdbId !== "string" || !body.imdbId.trim()) {
      return reply.code(400).send({ error: "imdbId is required" });
    }

    const imdbId = (body.imdbId as string).trim();
    const season = typeof body.season === "number" ? body.season : null;
    const episode = typeof body.episode === "number" ? body.episode : null;
    const progress =
      typeof body.progress === "number" ? Math.max(0, Math.min(100, body.progress)) : undefined;

    const session = await prisma.scrobbleSession.findFirst({
      where: {
        profileId: request.profileId!,
        imdbId,
        season,
        episode,
        status: { in: [ScrobbleStatus.playing, ScrobbleStatus.paused] },
      },
    });

    if (!session) return reply.code(404).send({ error: "No active scrobble session found" });

    const finalProgress = progress ?? session.progress;
    const watchedAt = new Date();
    const seriesImdbId = session.seriesImdbId;

    const stoppedSession = await prisma.scrobbleSession.update({
      where: { id: session.id },
      data: { status: ScrobbleStatus.stopped, progress: finalProgress },
    });

    let watchEvent = null;
    if (finalProgress >= SCROBBLE_COMPLETE_THRESHOLD) {
      const result = await recordWatchEvent({
        type: session.type,
        imdbId,
        seriesImdbId: seriesImdbId ?? undefined,
        season: session.season,
        episode: session.episode,
        watchedAt,
        source: "Scrobble",
        request,
      });
      watchEvent = result.watchEvent;
    } else {
      void pushTraktScrobble(
        "stop",
        {
          type: session.type,
          imdbId,
          seriesImdbId: session.seriesImdbId,
          season: session.season,
          episode: session.episode,
          progress: finalProgress,
        },
        request.log
      );
    }

    return reply.code(200).send({
      session: { id: stoppedSession.id, status: stoppedSession.status, progress: finalProgress },
      recorded: !!watchEvent,
      watchEvent,
    });
  });

  app.get("/scrobble/now-playing", async (request) => {
    const sessions = await prisma.scrobbleSession.findMany({
      where: {
        profileId: request.profileId!,
        status: { in: [ScrobbleStatus.playing, ScrobbleStatus.paused] },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (sessions.length === 0) return { sessions: [] };

    const imdbIds = [
      ...new Set([
        ...sessions.map((s) => s.imdbId),
        ...sessions.filter((s) => s.seriesImdbId).map((s) => s.seriesImdbId!),
      ]),
    ];

    const metadata =
      imdbIds.length > 0
        ? await prisma.metadata.findMany({
            where: { imdbId: { in: imdbIds } },
            select: { imdbId: true, name: true, poster: true },
          })
        : [];

    const metaByImdbId = new Map(metadata.map((m) => [m.imdbId, m]));

    return {
      sessions: sessions.map((session) => {
        const lookupId =
          session.type === "episode" && session.seriesImdbId
            ? session.seriesImdbId
            : session.imdbId;
        const meta = metaByImdbId.get(lookupId);
        return { ...session, name: meta?.name ?? null, poster: meta?.poster ?? null };
      }),
    };
  });
};

export default scrobbleRoutes;
