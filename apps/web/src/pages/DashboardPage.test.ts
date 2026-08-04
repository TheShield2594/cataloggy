import { describe, expect, it } from "vitest";
import type { SeriesProgress } from "../api";
import { computeProgressPct, msUntilNextBoundary, showsSameHeader, timeOfDayGreeting } from "./DashboardPage";

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

// Local time, deliberately: the greeting is about the hour the reader is living
// in, not UTC.
const at = (hour: number, minute = 0) => new Date(2026, 6, 15, hour, minute, 0, 0);

describe("timeOfDayGreeting", () => {
  it("names each part of the day", () => {
    expect(timeOfDayGreeting(at(2))).toBe("Good night");
    expect(timeOfDayGreeting(at(8))).toBe("Good morning");
    expect(timeOfDayGreeting(at(14))).toBe("Good afternoon");
    expect(timeOfDayGreeting(at(21))).toBe("Good evening");
  });

  it("switches exactly on the cutoff hours", () => {
    expect(timeOfDayGreeting(at(4, 59))).toBe("Good night");
    expect(timeOfDayGreeting(at(5))).toBe("Good morning");
    expect(timeOfDayGreeting(at(11, 59))).toBe("Good morning");
    expect(timeOfDayGreeting(at(12))).toBe("Good afternoon");
    expect(timeOfDayGreeting(at(17, 59))).toBe("Good afternoon");
    expect(timeOfDayGreeting(at(18))).toBe("Good evening");
  });
});

// Guards the correction the clock effect makes on mount: the effect schedules
// from a Date read after the first render, and if the two straddle a cutoff the
// header would otherwise show the pre-cutoff greeting until the *next* one —
// hours, not milliseconds.
describe("showsSameHeader", () => {
  const on = (day: number, hour: number, minute = 0) => new Date(2026, 6, day, hour, minute, 0, 0);

  it("treats instants within the same greeting and day as identical", () => {
    expect(showsSameHeader(on(15, 14), on(15, 14, 59))).toBe(true);
    expect(showsSameHeader(on(15, 12), on(15, 17, 59))).toBe(true);
  });

  it("spots a greeting cutoff crossed between the render and the effect", () => {
    expect(showsSameHeader(on(15, 11, 59), on(15, 12))).toBe(false);
    expect(showsSameHeader(on(15, 17, 59), on(15, 18))).toBe(false);
  });

  it("spots a date rollover the greeting alone would miss", () => {
    // Same greeting on both sides — only the date moved.
    expect(timeOfDayGreeting(on(15, 14))).toBe(timeOfDayGreeting(on(16, 14)));
    expect(showsSameHeader(on(15, 14), on(16, 14))).toBe(false);
  });
});

describe("msUntilNextBoundary", () => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;

  it("waits for the next greeting cutoff", () => {
    expect(msUntilNextBoundary(at(9, 30))).toBe(2 * HOUR + 30 * MINUTE); // → 12:00
    expect(msUntilNextBoundary(at(13))).toBe(5 * HOUR); // → 18:00
    expect(msUntilNextBoundary(at(2, 15))).toBe(2 * HOUR + 45 * MINUTE); // → 05:00
  });

  it("rolls over to midnight after the last cutoff of the day", () => {
    // Which is the boundary that also changes the date, the half of this the
    // greeting alone would miss.
    expect(msUntilNextBoundary(at(23, 30))).toBe(30 * MINUTE);
    expect(msUntilNextBoundary(at(18, 1))).toBe(5 * HOUR + 59 * MINUTE);
  });

  it("lands on the cutoff itself rather than firing again immediately", () => {
    // Woken exactly at 12:00, the next wake is 18:00 — not a zero-delay loop.
    expect(msUntilNextBoundary(at(12))).toBe(6 * HOUR);
  });

  it("never schedules a spin, whatever the clock does", () => {
    // A DST jump can put the computed boundary in the past; the floor keeps a
    // timer that would otherwise fire in a tight loop off the event loop.
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 1, 30, 59]) {
        expect(msUntilNextBoundary(at(hour, minute))).toBeGreaterThanOrEqual(MINUTE);
      }
    }
  });
});
