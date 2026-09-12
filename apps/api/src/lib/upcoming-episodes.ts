import type { CalendarEntry } from "@cataloggy/shared";
import { prisma } from "./prisma.js";
import { getTmdb } from "./tmdb-client.js";
import { showDetailsCache } from "./cache.js";
import type { ShowDetails } from "../tmdb.js";

async function getCachedShowDetails(
  tmdb: Awaited<ReturnType<typeof getTmdb>>,
  tmdbId: number
): Promise<ShowDetails | null> {
  const cacheKey = `show-details:${tmdb.getLanguage()}:${tmdbId}`;
  const cached = showDetailsCache.get(cacheKey);
  if (cached) return cached.details;

  const details = await tmdb.getShowDetails(tmdbId);
  // tmdb.getShowDetails returns null on a fetch/parse error (not a legitimate "no next
  // episode" state, which is `details.nextEpisodeToAir === null` on a successful call) —
  // don't cache that for hours, or a transient TMDB outage looks like it lasts that long.
  if (details) showDetailsCache.set(cacheKey, { details });
  return details;
}

/**
 * One upcoming episode.
 *
 * The shape itself lives in `@cataloggy/shared`, because `apps/web` validates
 * this response at its own boundary and the two definitions had been
 * hand-copied duplicates. Aliased rather than renamed at the call sites: within
 * the API this is an episode that has not aired, and "calendar" is what the one
 * route that serves them happens to be called.
 */
export type UpcomingEpisode = CalendarEntry;

/**
 * TMDB series statuses that rule out a next episode. Everything else —
 * "Returning Series", "In Production", "Planned", "Pilot", and a null status on
 * a row that predates a full metadata sync — is left in.
 *
 * Written as a deny-list rather than `status = 'Returning Series'` on purpose:
 * the cost of wrongly excluding a show is that its episode silently never
 * appears on the calendar and never notifies, so the list only names the two
 * statuses that mean "there will not be another one".
 */
const NO_FURTHER_EPISODES = ["Ended", "Canceled"];

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

  // Every show that survives this query costs a TMDB round trip below, so the
  // filtering has to happen here rather than on the results. The notification
  // job passes no limit — it has to consider every tracked show, since one
  // watched two years ago can still air tonight — which means `status` is the
  // only thing keeping its fan-out proportional to shows that can still air
  // rather than to the size of the library.
  const metadata = await prisma.metadata.findMany({
    where: {
      imdbId: { in: progressRows.map((p) => p.seriesImdbId) },
      type: "series",
      tmdbId: { not: null },
      OR: [{ status: null }, { status: { notIn: NO_FURTHER_EPISODES } }],
    },
    select: { imdbId: true, tmdbId: true, name: true, poster: true },
  });

  if (metadata.length === 0) return [];

  const metaByImdbId = new Map(metadata.map((m) => [m.imdbId, m]));
  // Ordered by the progress rows rather than by the metadata query, so the
  // most-recently-watched shows are still the ones fetched first.
  const seriesImdbIds = progressRows
    .map((p) => p.seriesImdbId)
    .filter((imdbId) => metaByImdbId.has(imdbId));

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

        const details = await getCachedShowDetails(tmdb, meta.tmdbId);
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
