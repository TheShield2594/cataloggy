import type { SeriesProgress } from "../../api";

// How far through a series (or a season) a viewer is, and what to call it.
// Pure, and apart from the two cards that draw it, so both agree on the reading
// and the arithmetic is testable without rendering anything.

const pctOf = (watched: number, total: number) => Math.min(Math.max((watched / total) * 100, 0), 100);

export function computeProgressPct(s: SeriesProgress): number | null {
  return typeof s.watchedEpisodes === "number" && s.totalEpisodes && s.totalEpisodes > 0
    ? pctOf(s.watchedEpisodes, s.totalEpisodes)
    : null;
}

export type ProgressSummary = { label: string; watched: number; total: number; pct: number };

/**
 * The bar the featured card draws, and what to call it.
 *
 * The season the viewer is actually in is the useful reading next to the
 * `S1:E5` marker above it, so it wins when TMDB knows how long that season is.
 * Series-wide totals are the fallback, and they're labelled as such — filling a
 * bar called "Season progress" from the series total is what made a show five
 * episodes into season 1 of 3 read `5 / 27 episodes` against a near-empty bar.
 */
export function computeProgressSummary(s: SeriesProgress): ProgressSummary | null {
  if (
    typeof s.seasonWatchedEpisodes === "number" &&
    typeof s.seasonTotalEpisodes === "number" &&
    s.seasonTotalEpisodes > 0
  ) {
    return {
      label: "Season progress",
      watched: s.seasonWatchedEpisodes,
      total: s.seasonTotalEpisodes,
      pct: pctOf(s.seasonWatchedEpisodes, s.seasonTotalEpisodes),
    };
  }
  if (typeof s.watchedEpisodes === "number" && s.totalEpisodes && s.totalEpisodes > 0) {
    return {
      label: "Series progress",
      watched: s.watchedEpisodes,
      total: s.totalEpisodes,
      pct: pctOf(s.watchedEpisodes, s.totalEpisodes),
    };
  }
  return null;
}

/**
 * The ` · 4 seasons` suffix under a Continue Watching title, empty when the
 * season count is unknown. Interpolating the number straight in gave a
 * one-season show `1 seasons`.
 */
export function seasonCountSuffix(totalSeasons: number | null | undefined): string {
  if (!totalSeasons || totalSeasons < 1) return "";
  return ` · ${totalSeasons} season${totalSeasons === 1 ? "" : "s"}`;
}
