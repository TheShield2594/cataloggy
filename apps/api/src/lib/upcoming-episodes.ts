import { prisma } from "./prisma.js";
import { getTmdb } from "./tmdb-client.js";

export type UpcomingEpisode = {
  seriesImdbId: string;
  seriesName: string;
  poster: string | null;
  season: number;
  episode: number;
  episodeName: string;
  airDate: string;
  overview: string | null;
};

export const getUpcomingEpisodes = async (
  profileId: string,
  daysAhead: number,
  limit: number | null = 30,
  spoilerProtection = false
): Promise<UpcomingEpisode[]> => {
  const progressRows = await prisma.seriesProgress.findMany({
    where: { profileId },
    orderBy: { lastWatchedAt: "desc" },
    ...(limit != null ? { take: limit } : {}),
  });

  if (progressRows.length === 0) return [];

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
    return [];
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const futureDate = new Date(today);
  futureDate.setUTCDate(futureDate.getUTCDate() + daysAhead);

  const upcoming: UpcomingEpisode[] = [];
  const batchSize = 5;

  for (let i = 0; i < seriesImdbIds.length; i += batchSize) {
    const batch = seriesImdbIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (imdbId) => {
        const meta = metaByImdbId.get(imdbId);
        if (!meta?.tmdbId) return [];

        const details = await tmdb.getShowDetails(meta.tmdbId);
        if (!details?.nextEpisodeToAir) return [];

        const ep = details.nextEpisodeToAir;
        const airDate = new Date(ep.air_date);
        if (Number.isNaN(airDate.getTime())) return [];
        if (airDate < today || airDate > futureDate) return [];

        return [{
          seriesImdbId: imdbId,
          seriesName: meta.name,
          poster: meta.poster,
          season: ep.season_number,
          episode: ep.episode_number,
          episodeName: spoilerProtection ? `Episode ${ep.episode_number}` : ep.name,
          airDate: ep.air_date,
          overview: spoilerProtection ? null : (ep.overview ?? null),
        }];
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") upcoming.push(...result.value);
    }
  }

  upcoming.sort((a, b) => a.airDate.localeCompare(b.airDate));
  return upcoming;
};
