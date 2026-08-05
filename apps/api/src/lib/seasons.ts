import { seasonsCache } from "./cache.js";
import { getTmdb } from "./tmdb-client.js";
import type { SeasonInfo } from "../tmdb.js";

/**
 * A series' seasons, with the episode count of each.
 *
 * TMDB is the only source and the result is cached per series, so the several
 * callers that need season shape for the same show in one request (next-episode
 * math, per-season progress) cost one lookup between them. Returns an empty
 * list rather than throwing when TMDB is unavailable or the series has no TMDB
 * id — callers treat "no season data" as a normal outcome.
 */
export async function getSeasonsForImdbId(imdbId: string, tmdbId: number | null): Promise<SeasonInfo[]> {
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
