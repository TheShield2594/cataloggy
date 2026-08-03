import { describe, expect, it } from "vitest";
import type { SeriesProgress } from "../api";
import { computeProgressPct } from "./DashboardPage";

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
