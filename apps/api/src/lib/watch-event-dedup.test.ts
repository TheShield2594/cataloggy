import { describe, expect, it } from "vitest";
import { watchEventDayWindow, watchEventDedupWhere } from "./watch-event-dedup.js";

// These assertions are the code-side half of `watchevent_dedup_key` (migration
// 20260814120000). If one drifts from the other the symptom is not a test failure
// but a 500 in production: the lookup misses a row the index then refuses to let
// anyone insert alongside.
describe("watchEventDayWindow", () => {
  it("spans the whole UTC day the watch falls in", () => {
    const { gte, lte } = watchEventDayWindow(new Date("2024-03-15T13:45:12.500Z"));
    expect(gte.toISOString()).toBe("2024-03-15T00:00:00.000Z");
    expect(lte.toISOString()).toBe("2024-03-15T23:59:59.999Z");
  });

  it("brackets midnight without leaking into the neighbouring days", () => {
    const { gte, lte } = watchEventDayWindow(new Date("2024-03-15T00:00:00.000Z"));
    expect(gte.toISOString()).toBe("2024-03-15T00:00:00.000Z");
    expect(lte.toISOString()).toBe("2024-03-15T23:59:59.999Z");
  });

  // The window is UTC, not local. A 23:30 UTC-05:00 watch is the next UTC day, and
  // the index — which casts through AT TIME ZONE 'UTC' — agrees.
  it("buckets by UTC rather than by the host's timezone", () => {
    const { gte } = watchEventDayWindow(new Date("2024-03-15T23:30:00-05:00"));
    expect(gte.toISOString()).toBe("2024-03-16T00:00:00.000Z");
  });

  it("does not mutate the date it was given", () => {
    const watchedAt = new Date("2024-03-15T13:45:12.500Z");
    watchEventDayWindow(watchedAt);
    expect(watchedAt.toISOString()).toBe("2024-03-15T13:45:12.500Z");
  });
});

describe("watchEventDedupWhere", () => {
  it("matches a movie on imdbId and the day, ignoring season and episode", () => {
    expect(
      watchEventDedupWhere({
        profileId: "p1",
        type: "movie",
        imdbId: "tt0111161",
        watchedAt: new Date("2024-03-15T13:45:00Z"),
      })
    ).toEqual({
      profileId: "p1",
      type: "movie",
      imdbId: "tt0111161",
      watchedAt: { gte: new Date("2024-03-15T00:00:00.000Z"), lte: new Date("2024-03-15T23:59:59.999Z") },
    });
  });

  it("matches an episode on the series id, not the episode's own imdbId", () => {
    expect(
      watchEventDedupWhere({
        profileId: "p1",
        type: "episode",
        imdbId: "tt0903747",
        season: 2,
        episode: 5,
        watchedAt: new Date("2024-03-15T13:45:00Z"),
      })
    ).toMatchObject({ seriesImdbId: "tt0903747", season: 2, episode: 5 });
  });

  // Movies leave both NULL, which is why the index coalesces them to -1 rather than
  // indexing the raw columns — Postgres would treat every NULL as distinct and
  // enforce nothing at all for films.
  it("normalises a missing season or episode to null rather than undefined", () => {
    const where = watchEventDedupWhere({
      profileId: "p1",
      type: "episode",
      imdbId: "tt0903747",
      watchedAt: new Date("2024-03-15T13:45:00Z"),
    });
    expect(where).toMatchObject({ season: null, episode: null });
  });
});
