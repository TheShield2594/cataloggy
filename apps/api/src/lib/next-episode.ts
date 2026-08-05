import { getSeasonsForImdbId } from "./seasons.js";
import type { SeasonInfo } from "../tmdb.js";

/**
 * Given the last watched season/episode, returns the next episode to watch,
 * rolling over to the next season's E1 once a season's episode count is
 * exhausted. Returns null if the series appears fully watched (no further
 * season exists past the last one with episodes).
 *
 * `knownSeasons` is for callers that already hold this series' season list:
 * a failed TMDB lookup isn't cached (a transient outage must not blank out
 * season data for the cache's lifetime), so a caller that looked the seasons
 * up itself would otherwise pay for a second failing request here.
 */
export async function computeNextEpisode(
  imdbId: string,
  tmdbId: number | null,
  lastSeason: number,
  lastEpisode: number,
  knownSeasons?: SeasonInfo[]
): Promise<{ season: number; episode: number } | null> {
  const seasons = knownSeasons ?? (await getSeasonsForImdbId(imdbId, tmdbId));
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
