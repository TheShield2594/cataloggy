import { WatchEventType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { upsertSeriesProgressIfNewer } from "../lib/series-progress.js";

const watchRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: unknown }>("/watch", async (request, reply) => {
    if (!request.body || typeof request.body !== "object") {
      return reply.code(400).send({ error: "type and imdbId are required" });
    }

    const body = request.body as {
      type?: unknown;
      imdbId?: unknown;
      seriesImdbId?: unknown;
      season?: unknown;
      episode?: unknown;
      watchedAt?: unknown;
    };

    if (!Object.values(WatchEventType).includes(body.type as WatchEventType)) {
      return reply.code(400).send({ error: "type must be one of: movie, episode" });
    }

    if (typeof body.imdbId !== "string" || !body.imdbId.trim()) {
      return reply.code(400).send({ error: "imdbId is required" });
    }

    if (
      body.seriesImdbId !== undefined &&
      (typeof body.seriesImdbId !== "string" || !body.seriesImdbId.trim())
    ) {
      return reply.code(400).send({ error: "seriesImdbId must be a non-empty string when provided" });
    }

    if (
      body.season !== undefined &&
      (!Number.isInteger(body.season) || (body.season as number) < 0)
    ) {
      return reply.code(400).send({ error: "season must be a non-negative integer when provided" });
    }

    if (
      body.episode !== undefined &&
      (!Number.isInteger(body.episode) || (body.episode as number) < 0)
    ) {
      return reply.code(400).send({ error: "episode must be a non-negative integer when provided" });
    }

    let watchedAt: Date;
    if (body.watchedAt !== undefined) {
      if (typeof body.watchedAt !== "string") {
        return reply.code(400).send({ error: "watchedAt must be an ISO 8601 string" });
      }
      watchedAt = new Date(body.watchedAt);
      if (Number.isNaN(watchedAt.getTime())) {
        return reply.code(400).send({ error: "watchedAt must be a valid ISO 8601 date" });
      }
    } else {
      watchedAt = new Date();
    }

    const type = body.type as WatchEventType;
    const imdbId = (body.imdbId as string).trim();
    const seriesImdbId = body.seriesImdbId ? (body.seriesImdbId as string).trim() : null;
    const season = (body.season as number | undefined) ?? null;
    const episode = (body.episode as number | undefined) ?? null;

    const dayStart = new Date(watchedAt);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(watchedAt);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const existing = await prisma.watchEvent.findFirst({
      where: { imdbId, season, episode, watchedAt: { gte: dayStart, lte: dayEnd } },
    });

    if (existing) {
      const updated = await prisma.watchEvent.update({
        where: { id: existing.id },
        data: { plays: existing.plays + 1 },
      });
      return reply.code(200).send({ watchEvent: updated });
    }

    const watchEvent = await prisma.watchEvent.create({
      data: { type, imdbId, seriesImdbId, season, episode, watchedAt },
    });

    if (type === "episode" && seriesImdbId && season !== null && episode !== null) {
      await upsertSeriesProgressIfNewer(seriesImdbId, {
        lastSeason: season,
        lastEpisode: episode,
        lastWatchedAt: watchedAt,
      });
    }

    return reply.code(201).send({ watchEvent });
  });

  app.delete<{ Params: { eventId: string } }>("/watch/:eventId", async (request, reply) => {
    const { eventId } = request.params;
    try {
      await prisma.$transaction(async (tx) => {
        const event = await tx.watchEvent.findUnique({ where: { id: eventId } });
        if (!event) throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });

        await tx.watchEvent.delete({ where: { id: eventId } });

        if (event.type === "episode" && event.seriesImdbId) {
          const latest = await tx.watchEvent.findFirst({
            where: {
              seriesImdbId: event.seriesImdbId,
              type: "episode",
              season: { not: null },
              episode: { not: null },
            },
            orderBy: { watchedAt: "desc" },
          });

          if (latest && latest.season != null && latest.episode != null) {
            await tx.seriesProgress.upsert({
              where: { seriesImdbId: event.seriesImdbId },
              update: {
                lastSeason: latest.season,
                lastEpisode: latest.episode,
                lastWatchedAt: latest.watchedAt,
                updatedAt: new Date(),
              },
              create: {
                seriesImdbId: event.seriesImdbId,
                lastSeason: latest.season,
                lastEpisode: latest.episode,
                lastWatchedAt: latest.watchedAt,
                updatedAt: new Date(),
              },
            });
          } else {
            await tx.seriesProgress.deleteMany({ where: { seriesImdbId: event.seriesImdbId } });
          }
        }
      });
      return reply.code(204).send();
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "NOT_FOUND") {
        return reply.code(404).send({ error: "Watch event not found" });
      }
      throw err;
    }
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/watch/history",
    async (request) => {
      const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
      const offset = Math.max(Number(request.query.offset) || 0, 0);

      const events = await prisma.watchEvent.findMany({
        orderBy: { watchedAt: "desc" },
        take: limit,
        skip: offset,
      });

      if (events.length === 0) return { history: [] };

      const movieImdbIds = events.filter((e) => e.type === "movie").map((e) => e.imdbId);
      const seriesImdbIds = events
        .filter((e) => e.type === "episode" && e.seriesImdbId)
        .map((e) => e.seriesImdbId!);
      const allMetadataIds = [...new Set([...movieImdbIds, ...seriesImdbIds])];

      const metadata =
        allMetadataIds.length > 0
          ? await prisma.metadata.findMany({
              where: { imdbId: { in: allMetadataIds } },
              select: { imdbId: true, type: true, name: true, poster: true },
            })
          : [];

      const metadataByImdbId = new Map(metadata.map((m) => [m.imdbId, m]));

      const history = events.map((event) => {
        const lookupId =
          event.type === "episode" && event.seriesImdbId ? event.seriesImdbId : event.imdbId;
        const meta = metadataByImdbId.get(lookupId);
        return { ...event, name: meta?.name ?? null, poster: meta?.poster ?? null };
      });

      return { history };
    }
  );

  app.get("/watch/stats", async () => {
    const [movieAgg, episodeAgg] = await Promise.all([
      prisma.watchEvent.aggregate({ where: { type: "movie" }, _count: true, _sum: { plays: true } }),
      prisma.watchEvent.aggregate({ where: { type: "episode" }, _count: true, _sum: { plays: true } }),
    ]);

    return {
      totalMovies: movieAgg._count,
      totalEpisodes: episodeAgg._count,
      totalPlays: (movieAgg._sum.plays ?? 0) + (episodeAgg._sum.plays ?? 0),
    };
  });

  app.get("/watch/stats/detailed", async () => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setUTCMonth(twelveMonthsAgo.getUTCMonth() - 12);
    twelveMonthsAgo.setUTCDate(1);
    twelveMonthsAgo.setUTCHours(0, 0, 0, 0);

    const [monthlyEvents, distinctMovieIds, distinctSeriesIds, watchDates] = await Promise.all([
      prisma.watchEvent.findMany({
        where: { watchedAt: { gte: twelveMonthsAgo } },
        select: { type: true, watchedAt: true, plays: true },
      }),
      prisma.watchEvent.findMany({
        where: { type: "movie" },
        select: { imdbId: true },
        distinct: ["imdbId"],
      }),
      prisma.watchEvent.findMany({
        where: { type: "episode", seriesImdbId: { not: null } },
        select: { seriesImdbId: true },
        distinct: ["seriesImdbId"],
      }),
      prisma.watchEvent.findMany({ select: { watchedAt: true } }),
    ]);

    const monthlyMap = new Map<string, { movies: number; episodes: number }>();
    for (const event of monthlyEvents) {
      const key = `${event.watchedAt.getUTCFullYear()}-${String(event.watchedAt.getUTCMonth() + 1).padStart(2, "0")}`;
      let entry = monthlyMap.get(key);
      if (!entry) {
        entry = { movies: 0, episodes: 0 };
        monthlyMap.set(key, entry);
      }
      if (event.type === "movie") entry.movies += event.plays;
      else entry.episodes += event.plays;
    }

    const monthly: { month: string; movies: number; episodes: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const entry = monthlyMap.get(key) ?? { movies: 0, episodes: 0 };
      monthly.push({ month: key, ...entry });
    }

    const movieImdbIds = distinctMovieIds.map((e) => e.imdbId);
    const seriesImdbIds = distinctSeriesIds.map((e) => e.seriesImdbId!);
    const allMetadataIds = [...movieImdbIds, ...seriesImdbIds];

    const metadata =
      allMetadataIds.length > 0
        ? await prisma.metadata.findMany({
            where: { imdbId: { in: allMetadataIds } },
            select: { genres: true },
          })
        : [];

    const genreCounts = new Map<string, number>();
    for (const m of metadata) {
      for (const g of m.genres) {
        genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
      }
    }
    const genreDistribution = [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([genre, count]) => ({ genre, count }));

    const watchDays = new Set(watchDates.map((e) => e.watchedAt.toISOString().slice(0, 10)));
    const sortedDays = [...watchDays].sort();
    let longestStreak = 0;
    let currentStreak = 0;

    if (sortedDays.length > 0) {
      let streak = 1;
      for (let i = 1; i < sortedDays.length; i++) {
        const prev = new Date(sortedDays[i - 1]);
        const curr = new Date(sortedDays[i]);
        if (curr.getTime() - prev.getTime() === 86_400_000) {
          streak++;
        } else {
          if (streak > longestStreak) longestStreak = streak;
          streak = 1;
        }
      }
      if (streak > longestStreak) longestStreak = streak;

      const todayStr = new Date().toISOString().slice(0, 10);
      if (watchDays.has(todayStr)) {
        currentStreak = 1;
        for (let i = sortedDays.length - 2; i >= 0; i--) {
          const curr = new Date(sortedDays[i + 1]);
          const prev = new Date(sortedDays[i]);
          if (curr.getTime() - prev.getTime() === 86_400_000) {
            currentStreak++;
          } else {
            break;
          }
        }
      }
    }

    const topRated =
      allMetadataIds.length > 0
        ? await prisma.metadata.findMany({
            where: { imdbId: { in: allMetadataIds }, rating: { not: null } },
            select: { imdbId: true, name: true, type: true, rating: true, poster: true },
            orderBy: { rating: "desc" },
            take: 10,
          })
        : [];

    return {
      monthly,
      genreDistribution,
      currentStreak,
      longestStreak,
      topRated: topRated.map((m) => ({
        imdbId: m.imdbId,
        name: m.name,
        type: m.type,
        rating: m.rating,
        poster: m.poster,
      })),
    };
  });
};

export default watchRoutes;
