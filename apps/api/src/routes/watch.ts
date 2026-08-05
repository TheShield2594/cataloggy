import { Prisma, WatchEventType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { resolveProfile } from "../lib/profile.js";
import { recordWatchEvent } from "../lib/watch-event.js";
import { UUID_V4_PATTERN } from "../lib/types.js";

function serializeWatchEvent<T extends { traktHistoryId: bigint | null }>(event: T) {
  return { ...event, traktHistoryId: event.traktHistoryId != null ? event.traktHistoryId.toString() : null };
}

// Shapes returned by the two aggregate queries behind /watch/stats/detailed.
// The `json_agg` columns arrive already parsed, so they are plain arrays here.
type EventStatsRow = {
  longest_streak: bigint;
  current_streak: bigint;
  monthly: { month: string; movies: number; episodes: number }[] | null;
};

type MetadataStatsRow = {
  genres: { genre: string; count: number }[] | null;
  top_rated: {
    imdbId: string;
    name: string;
    type: string;
    rating: number | null;
    poster: string | null;
  }[] | null;
};

const watchRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

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
      dateUnknown?: unknown;
      note?: unknown;
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
    const seriesImdbId = body.seriesImdbId ? (body.seriesImdbId as string).trim() : undefined;
    const season = (body.season as number | undefined) ?? null;
    const episode = (body.episode as number | undefined) ?? null;
    const dateUnknown = body.dateUnknown === true;

    if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
      return reply.code(400).send({ error: "note must be a string when provided" });
    }
    const note = typeof body.note === "string" ? body.note.trim() || null : undefined;

    const { watchEvent, wasCreated } = await recordWatchEvent({
      type,
      imdbId,
      seriesImdbId,
      season,
      episode,
      watchedAt,
      dateUnknown,
      note,
      source: "manual",
      profileId: request.profileId!,
      log: request.log,
    });

    return reply.code(wasCreated ? 201 : 200).send({ watchEvent: serializeWatchEvent(watchEvent) });
  });

  // `WatchEvent.id` is a uuid column, so a malformed id is rejected by Postgres
  // rather than simply matching nothing — an unhandled driver error and a 500
  // where the caller sent a bad request.
  app.patch<{ Params: { eventId: string }; Body: unknown }>("/watch/:eventId", async (request, reply) => {
    const { eventId } = request.params;
    const profileId = request.profileId!;
    if (!UUID_V4_PATTERN.test(eventId)) {
      return reply.code(400).send({ error: "eventId must be a valid UUID" });
    }
    const body = request.body as { note?: unknown } | null;
    if (!body || (body.note !== null && typeof body.note !== "string")) {
      return reply.code(400).send({ error: "note must be a string or null" });
    }

    const event = await prisma.watchEvent.findFirst({ where: { id: eventId, profileId } });
    if (!event) return reply.code(404).send({ error: "Watch event not found" });

    const note = typeof body.note === "string" ? body.note.trim() || null : null;
    const updated = await prisma.watchEvent.update({ where: { id: eventId }, data: { note } });
    return { watchEvent: serializeWatchEvent(updated) };
  });

  app.delete<{ Params: { eventId: string } }>("/watch/:eventId", async (request, reply) => {
    const { eventId } = request.params;
    const profileId = request.profileId!;
    if (!UUID_V4_PATTERN.test(eventId)) {
      return reply.code(400).send({ error: "eventId must be a valid UUID" });
    }
    try {
      await prisma.$transaction(async (tx) => {
        const event = await tx.watchEvent.findFirst({ where: { id: eventId, profileId } });
        if (!event) throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });

        await tx.watchEvent.delete({ where: { id: eventId } });

        if (event.type === "episode" && event.seriesImdbId) {
          const latest = await tx.watchEvent.findFirst({
            where: {
              profileId,
              seriesImdbId: event.seriesImdbId,
              type: "episode",
              season: { not: null },
              episode: { not: null },
            },
            orderBy: { watchedAt: "desc" },
          });

          if (latest && latest.season != null && latest.episode != null) {
            await tx.seriesProgress.upsert({
              where: { profileId_seriesImdbId: { profileId, seriesImdbId: event.seriesImdbId } },
              update: {
                lastSeason: latest.season,
                lastEpisode: latest.episode,
                lastWatchedAt: latest.watchedAt,
                updatedAt: new Date(),
              },
              create: {
                profileId,
                seriesImdbId: event.seriesImdbId,
                lastSeason: latest.season,
                lastEpisode: latest.episode,
                lastWatchedAt: latest.watchedAt,
                updatedAt: new Date(),
              },
            });
          } else {
            await tx.seriesProgress.deleteMany({
              where: { profileId, seriesImdbId: event.seriesImdbId },
            });
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

  app.get<{ Querystring: { limit?: string; offset?: string; imdbId?: string; type?: string } }>(
    "/watch/history",
    async (request) => {
      const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
      const offset = Math.max(Number(request.query.offset) || 0, 0);
      const imdbId = request.query.imdbId?.trim();
      // Filtering here rather than client-side: the client paginates, so a
      // filter applied to the loaded page only searches the rows already
      // fetched and reports "nothing" for a type that's further back.
      // Anything unrecognised is ignored rather than rejected.
      const type = request.query.type === "movie" || request.query.type === "episode"
        ? request.query.type
        : undefined;

      const events = await prisma.watchEvent.findMany({
        where: {
          profileId: request.profileId!,
          ...(imdbId ? { OR: [{ imdbId }, { seriesImdbId: imdbId }] } : {}),
          ...(type ? { type } : {}),
        },
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
        return { ...serializeWatchEvent(event), name: meta?.name ?? null, poster: meta?.poster ?? null };
      });

      return { history };
    }
  );

  app.get("/watch/stats", async (request) => {
    const profileId = request.profileId!;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [movieAgg, episodeAgg, playsThisWeek] = await Promise.all([
      prisma.watchEvent.aggregate({
        where: { profileId, type: "movie" },
        _count: true,
        _sum: { plays: true },
      }),
      prisma.watchEvent.aggregate({
        where: { profileId, type: "episode" },
        _count: true,
        _sum: { plays: true },
      }),
      prisma.watchEvent.count({
        where: { profileId, dateUnknown: false, watchedAt: { gte: weekAgo } },
      }),
    ]);

    return {
      totalMovies: movieAgg._count,
      totalEpisodes: episodeAgg._count,
      totalPlays: (movieAgg._sum.plays ?? 0) + (episodeAgg._sum.plays ?? 0),
      playsThisWeek,
    };
  });

  app.get("/watch/stats/detailed", async (request) => {
    const profileId = request.profileId!;
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setUTCMonth(twelveMonthsAgo.getUTCMonth() - 12);
    twelveMonthsAgo.setUTCDate(1);
    twelveMonthsAgo.setUTCHours(0, 0, 0, 0);

    // Everything here is aggregated in Postgres rather than in Node: the inputs
    // (every event in the window, every distinct title ever watched) grow without
    // bound with watch history, but the outputs are fixed-size — 12 monthly
    // buckets, 15 genres, 10 titles. Two round trips, one per source table.
    const [eventStats, metadataStats] = await Promise.all([
      prisma.$queryRaw<EventStatsRow[]>(Prisma.sql`
        WITH distinct_days AS (
          SELECT DISTINCT DATE("watchedAt" AT TIME ZONE 'UTC') AS day
          FROM "WatchEvent"
          WHERE "profileId" = ${profileId}::uuid
        ),
        grouped AS (
          SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int * INTERVAL '1 day' AS grp
          FROM distinct_days
        ),
        run_lengths AS (
          SELECT grp, COUNT(*) AS streak_len, MAX(day) AS streak_end
          FROM grouped
          GROUP BY grp
        ),
        monthly AS (
          SELECT
            to_char(date_trunc('month', "watchedAt" AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
            COALESCE(SUM(plays) FILTER (WHERE type = 'movie'), 0)::int AS movies,
            COALESCE(SUM(plays) FILTER (WHERE type <> 'movie'), 0)::int AS episodes
          FROM "WatchEvent"
          WHERE "profileId" = ${profileId}::uuid AND "watchedAt" >= ${twelveMonthsAgo}
          GROUP BY 1
        )
        SELECT
          COALESCE((SELECT MAX(streak_len) FROM run_lengths), 0) AS longest_streak,
          COALESCE((SELECT streak_len FROM run_lengths WHERE streak_end = (now() AT TIME ZONE 'UTC')::date), 0) AS current_streak,
          COALESCE((SELECT json_agg(m) FROM monthly m), '[]'::json) AS monthly
      `),
      // Joined on imdbId alone (not imdbId + type) to match the historical
      // behaviour: a title with both a movie and a series metadata row
      // contributes both to the genre histogram and to the top-rated list.
      prisma.$queryRaw<MetadataStatsRow[]>(Prisma.sql`
        WITH watched AS (
          SELECT DISTINCT "imdbId" AS imdb_id
          FROM "WatchEvent"
          WHERE "profileId" = ${profileId}::uuid AND type = 'movie'
          UNION
          SELECT DISTINCT "seriesImdbId"
          FROM "WatchEvent"
          WHERE "profileId" = ${profileId}::uuid AND type = 'episode' AND "seriesImdbId" IS NOT NULL
        ),
        watched_metadata AS (
          SELECT m."imdbId", m.name, m.type, m.rating, m.poster, m.genres
          FROM watched w
          JOIN "Metadata" m ON m."imdbId" = w.imdb_id
        ),
        genre_counts AS (
          SELECT genre, COUNT(*)::int AS count
          FROM watched_metadata wm, unnest(wm.genres) AS genre
          GROUP BY genre
          ORDER BY count DESC, genre ASC
          LIMIT 15
        ),
        top_rated AS (
          SELECT "imdbId", name, type, rating, poster
          FROM watched_metadata
          WHERE rating IS NOT NULL
          ORDER BY rating DESC, "imdbId" ASC
          LIMIT 10
        )
        SELECT
          COALESCE((
            SELECT json_agg(json_build_object('genre', genre, 'count', count) ORDER BY count DESC, genre ASC)
            FROM genre_counts
          ), '[]'::json) AS genres,
          COALESCE((
            SELECT json_agg(
              json_build_object('imdbId', "imdbId", 'name', name, 'type', type, 'rating', rating, 'poster', poster)
              ORDER BY rating DESC, "imdbId" ASC
            )
            FROM top_rated
          ), '[]'::json) AS top_rated
      `),
    ]);

    const monthlyMap = new Map(
      (eventStats[0]?.monthly ?? []).map((row) => [
        row.month,
        { movies: row.movies, episodes: row.episodes },
      ])
    );

    const monthly: { month: string; movies: number; episodes: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const entry = monthlyMap.get(key) ?? { movies: 0, episodes: 0 };
      monthly.push({ month: key, ...entry });
    }

    return {
      monthly,
      genreDistribution: metadataStats[0]?.genres ?? [],
      currentStreak: Number(eventStats[0]?.current_streak ?? 0),
      longestStreak: Number(eventStats[0]?.longest_streak ?? 0),
      topRated: metadataStats[0]?.top_rated ?? [],
    };
  });

  app.get<{ Params: { year: string } }>("/watch/stats/year/:year", async (request, reply) => {
    const profileId = request.profileId!;
    if (!/^\d{4}$/.test(request.params.year)) {
      return reply.code(400).send({ error: "year must be a valid 4-digit year" });
    }
    const year = Number(request.params.year);
    if (year < 1900) {
      return reply.code(400).send({ error: "year must be a valid 4-digit year" });
    }

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

    const [events, topRatings] = await Promise.all([
      prisma.watchEvent.findMany({
        where: { profileId, watchedAt: { gte: yearStart, lt: yearEnd } },
        select: { type: true, imdbId: true, seriesImdbId: true, watchedAt: true, plays: true },
      }),
      prisma.rating.findMany({
        where: { profileId, ratedAt: { gte: yearStart, lt: yearEnd }, type: { in: ["movie", "series"] } },
        orderBy: { rating: "desc" },
        take: 10,
        select: { imdbId: true, type: true, rating: true },
      }),
    ]);

    const totalMovies = events.filter((e) => e.type === "movie").reduce((sum, e) => sum + e.plays, 0);
    const totalEpisodes = events.filter((e) => e.type === "episode").reduce((sum, e) => sum + e.plays, 0);

    const movieImdbIds = events.filter((e) => e.type === "movie").map((e) => e.imdbId);
    const seriesImdbIds = events
      .filter((e) => e.type === "episode" && e.seriesImdbId)
      .map((e) => e.seriesImdbId!);
    const ratingImdbIds = topRatings.map((r) => r.imdbId);
    const allMetadataIds = [...new Set([...movieImdbIds, ...seriesImdbIds, ...ratingImdbIds])];

    const metadata =
      allMetadataIds.length > 0
        ? await prisma.metadata.findMany({
            where: { imdbId: { in: allMetadataIds } },
            select: { imdbId: true, name: true, type: true, poster: true, genres: true, runtime: true },
          })
        : [];
    const metadataByImdbId = new Map(metadata.map((m) => [m.imdbId, m]));

    let totalRuntimeMinutes = 0;
    const genreCounts = new Map<string, number>();
    for (const event of events) {
      const lookupId = event.type === "episode" && event.seriesImdbId ? event.seriesImdbId : event.imdbId;
      const meta = metadataByImdbId.get(lookupId);
      if (!meta) continue;
      if (meta.runtime) totalRuntimeMinutes += meta.runtime * event.plays;
      for (const genre of meta.genres) {
        genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + event.plays);
      }
    }
    const topGenres = [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([genre, count]) => ({ genre, count }));

    const monthCounts = new Map<number, number>();
    for (const event of events) {
      const month = event.watchedAt.getUTCMonth();
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + event.plays);
    }
    let busiestMonth: number | null = null;
    let busiestMonthCount = 0;
    for (const [month, count] of monthCounts.entries()) {
      if (count > busiestMonthCount) {
        busiestMonth = month;
        busiestMonthCount = count;
      }
    }

    const topRated = topRatings.map((r) => {
      const meta = metadataByImdbId.get(r.imdbId);
      return {
        imdbId: r.imdbId,
        type: r.type,
        name: meta?.name ?? null,
        poster: meta?.poster ?? null,
        rating: r.rating,
      };
    });

    return {
      year,
      totalMovies,
      totalEpisodes,
      totalRuntimeMinutes,
      topGenres,
      topRated,
      busiestMonth,
      busiestMonthCount,
    };
  });
};

export default watchRoutes;
