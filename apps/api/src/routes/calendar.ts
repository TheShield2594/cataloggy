import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getTmdb } from "../lib/tmdb-client.js";

type CalendarEntry = {
  seriesImdbId: string;
  seriesName: string;
  poster: string | null;
  season: number;
  episode: number;
  episodeName: string;
  airDate: string;
  overview: string | null;
};

const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { days?: string } }>("/calendar", async (request) => {
    const daysAhead = Math.min(Math.max(Number(request.query.days) || 30, 1), 90);

    const progressRows = await prisma.seriesProgress.findMany({
      orderBy: { lastWatchedAt: "desc" },
      take: 30,
    });

    if (progressRows.length === 0) return { calendar: [] };

    const seriesImdbIds = progressRows.map((p) => p.seriesImdbId);
    const metadata = await prisma.metadata.findMany({
      where: { imdbId: { in: seriesImdbIds }, type: "series" },
      select: { imdbId: true, tmdbId: true, name: true, poster: true },
    });

    const metaByImdbId = new Map(metadata.map((m) => [m.imdbId, m]));

    let tmdb: Awaited<ReturnType<typeof getTmdb>>;
    try {
      tmdb = await getTmdb();
    } catch {
      return { calendar: [] };
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const calendar: CalendarEntry[] = [];
    const batchSize = 5;

    for (let i = 0; i < seriesImdbIds.length; i += batchSize) {
      const batch = seriesImdbIds.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (imdbId) => {
          const meta = metaByImdbId.get(imdbId);
          if (!meta?.tmdbId) return [];

          const details = await tmdb.getShowDetails(meta.tmdbId);
          if (!details) return [];

          const entries: CalendarEntry[] = [];

          if (details.nextEpisodeToAir) {
            const ep = details.nextEpisodeToAir;
            const airDate = new Date(ep.air_date);
            if (airDate >= today && airDate <= futureDate) {
              entries.push({
                seriesImdbId: imdbId,
                seriesName: meta.name,
                poster: meta.poster,
                season: ep.season_number,
                episode: ep.episode_number,
                episodeName: ep.name,
                airDate: ep.air_date,
                overview: ep.overview ?? null,
              });
            }
          }

          return entries;
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          calendar.push(...result.value);
        }
      }
    }

    calendar.sort((a, b) => a.airDate.localeCompare(b.airDate));

    return { calendar };
  });
};

export default calendarRoutes;
