import { describe, expect, it } from "vitest";
import type { SeriesProgress } from "../../api";
import { computeProgressPct, computeProgressSummary, seasonCountSuffix } from "./series-progress";

const series = (overrides: Partial<SeriesProgress> = {}): SeriesProgress => ({
  imdbId: "tt0903747",
  name: "Breaking Bad",
  lastSeason: 1,
  lastEpisode: 1,
  nextSeason: 1,
  nextEpisode: 2,
  totalEpisodes: 62,
  watchedEpisodes: 31,
  ...overrides,
});

describe("computeProgressPct", () => {
  it("returns the watched share as a percentage", () => {
    expect(computeProgressPct(series())).toBeCloseTo(50);
    expect(computeProgressPct(series({ watchedEpisodes: 0 }))).toBe(0);
    expect(computeProgressPct(series({ watchedEpisodes: 62 }))).toBe(100);
  });

  it("clamps a watch count that overruns the episode total", () => {
    expect(computeProgressPct(series({ watchedEpisodes: 80 }))).toBe(100);
  });

  it("clamps negative watch counts to zero", () => {
    expect(computeProgressPct(series({ watchedEpisodes: -5 }))).toBe(0);
  });

  it("returns null when the episode total is unknown, so no bar is drawn", () => {
    expect(computeProgressPct(series({ totalEpisodes: null }))).toBeNull();
    expect(computeProgressPct(series({ totalEpisodes: undefined }))).toBeNull();
    expect(computeProgressPct(series({ totalEpisodes: 0 }))).toBeNull();
  });

  it("returns null when the watched count is missing", () => {
    expect(computeProgressPct(series({ watchedEpisodes: null }))).toBeNull();
    expect(computeProgressPct(series({ watchedEpisodes: undefined }))).toBeNull();
  });
});

describe("computeProgressSummary", () => {
  it("counts within the season the viewer is in, and says so", () => {
    expect(
      computeProgressSummary(series({ lastSeason: 1, seasonTotalEpisodes: 7, seasonWatchedEpisodes: 5 }))
    ).toEqual({ label: "Season progress", watched: 5, total: 7, pct: (5 / 7) * 100 });
  });

  it("falls back to series totals under a label that matches them", () => {
    // The bug: series-wide numbers under "Season progress" read
    // `5 / 27 episodes` for a show five episodes into season 1 of 3.
    expect(computeProgressSummary(series({ watchedEpisodes: 5, totalEpisodes: 27 }))).toEqual({
      label: "Series progress",
      watched: 5,
      total: 27,
      pct: (5 / 27) * 100,
    });
  });

  it("falls back when TMDB has no episode count for the current season", () => {
    expect(computeProgressSummary(series({ seasonTotalEpisodes: null, seasonWatchedEpisodes: 5 }))?.label).toBe(
      "Series progress"
    );
    expect(computeProgressSummary(series({ seasonTotalEpisodes: 0, seasonWatchedEpisodes: 5 }))?.label).toBe(
      "Series progress"
    );
    expect(computeProgressSummary(series({ seasonTotalEpisodes: 7, seasonWatchedEpisodes: null }))?.label).toBe(
      "Series progress"
    );
  });

  it("counts a season nobody has started as zero rather than dropping the bar", () => {
    expect(
      computeProgressSummary(series({ seasonTotalEpisodes: 10, seasonWatchedEpisodes: 0 }))
    ).toEqual({ label: "Season progress", watched: 0, total: 10, pct: 0 });
  });

  it("clamps a season count that overruns its total", () => {
    expect(
      computeProgressSummary(series({ seasonTotalEpisodes: 10, seasonWatchedEpisodes: 12 }))?.pct
    ).toBe(100);
  });

  it("returns null when neither season nor series totals are known, so no bar is drawn", () => {
    expect(computeProgressSummary(series({ totalEpisodes: null, seasonTotalEpisodes: null }))).toBeNull();
  });
});

describe("seasonCountSuffix", () => {
  it("pluralises the season count", () => {
    // `1 seasons` is what interpolating the number straight in produced.
    expect(seasonCountSuffix(1)).toBe(" · 1 season");
    expect(seasonCountSuffix(4)).toBe(" · 4 seasons");
  });

  it("says nothing when the season count is unknown or nonsense", () => {
    expect(seasonCountSuffix(null)).toBe("");
    expect(seasonCountSuffix(undefined)).toBe("");
    expect(seasonCountSuffix(0)).toBe("");
    expect(seasonCountSuffix(-2)).toBe("");
  });
});
