import { seasonsCache } from "./cache.js";
import { getTmdb } from "./tmdb-client.js";
import type { SeasonInfo } from "../tmdb.js";

async function getSeasonsForImdbId(imdbId: string, tmdbId: number | null): Promise<SeasonInfo[]> {
  const cacheKey = `seasons:${imdbId}`;
  const cached = seasonsCache.get(cacheKey);
  if (cached) return cached;

  if (!tmdbId) return [];

  try {
    const tmdb = await getTmdb();
    const seasons = await tmdb.getSeasons(tmdbId);
    seasonsCache.set(cacheKey, seasons);
    return seasons;
  } catch {
    return [];
  }
}

/**
 * Given the last watched season/episode, returns the next episode to watch,
 * rolling over to the next season's E1 once a season's episode count is
 * exhausted. Returns null if the series appears fully watched (no further
 * season exists past the last one with episodes).
 */
export async function computeNextEpisode(
  imdbId: string,
  tmdbId: number | null,
  lastSeason: number,
  lastEpisode: number
): Promise<{ season: number; episode: number } | null> {
  const seasons = await getSeasonsForImdbId(imdbId, tmdbId);
  if (seasons.length === 0) {
    // No season data available — fall back to naive increment.
    return { season: lastSeason, episode: lastEpisode + 1 };
  }

  const currentSeason = seasons.find((s) => s.seasonNumber === lastSeason);
  if (!currentSeason || lastEpisode < currentSeason.episodeCount) {
    return { season: lastSeason, episode: lastEpisode + 1 };
  }

  const nextSeason = seasons
    .filter((s) => s.seasonNumber > lastSeason && s.episodeCount > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)[0];

  if (!nextSeason) return null;

  return { season: nextSeason.seasonNumber, episode: 1 };
}
