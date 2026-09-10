import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SeasonInfo } from "../tmdb.js";

const getSeasonsForImdbId = vi.fn();
vi.mock("./seasons.js", () => ({
  getSeasonsForImdbId: (...args: unknown[]) => getSeasonsForImdbId(...args),
}));

const { computeNextEpisode } = await import("./next-episode.js");

// This decides what "next episode" means everywhere it is asked: Continue
// Watching, the add-on's next-up, and what a notification says. Getting it
// wrong is silent — the app confidently names an episode, and nothing looks
// broken until someone notices they were sent to the wrong one.

const SOPRANOS = "tt0141842";

const seasons = (...counts: [number, number][]): SeasonInfo[] =>
  counts.map(([seasonNumber, episodeCount]) => ({ seasonNumber, episodeCount }) as SeasonInfo);

beforeEach(() => {
  getSeasonsForImdbId.mockReset();
});

describe("computeNextEpisode", () => {
  it("advances within a season", async () => {
    const known = seasons([1, 13], [2, 13]);

    expect(await computeNextEpisode(SOPRANOS, 1, 2, 7, known)).toEqual({ season: 2, episode: 8 });
  });

  it("rolls over to the next season's first episode at the end of one", async () => {
    const known = seasons([1, 13], [2, 13], [3, 13]);

    expect(await computeNextEpisode(SOPRANOS, 1, 2, 13, known)).toEqual({ season: 3, episode: 1 });
  });

  it("returns null when the last season is finished", async () => {
    const known = seasons([1, 13], [2, 13]);

    expect(await computeNextEpisode(SOPRANOS, 1, 2, 13, known)).toBeNull();
  });

  it("skips a season with no episodes yet, rather than stopping at it", async () => {
    // An announced-but-unaired season comes back with episodeCount 0. Rolling
    // into its E1 would name an episode that does not exist.
    const known = seasons([1, 13], [2, 13], [3, 0], [4, 10]);

    expect(await computeNextEpisode(SOPRANOS, 1, 2, 13, known)).toEqual({ season: 4, episode: 1 });
  });

  it("returns null when every later season is empty", async () => {
    const known = seasons([1, 13], [2, 0]);

    expect(await computeNextEpisode(SOPRANOS, 1, 1, 13, known)).toBeNull();
  });

  it("takes the lowest later season, not the first one listed", async () => {
    const known = seasons([1, 13], [4, 10], [3, 10]);

    expect(await computeNextEpisode(SOPRANOS, 1, 1, 13, known)).toEqual({ season: 3, episode: 1 });
  });

  it("increments naively when TMDB knows no seasons at all", async () => {
    // A failed lookup is not cached, so this is "we don't know" rather than
    // "there is nothing" — guessing the next episode beats naming none.
    expect(await computeNextEpisode(SOPRANOS, 1, 2, 7, [])).toEqual({ season: 2, episode: 8 });
  });

  it("increments naively when the watched season is not in the list", async () => {
    // Specials (season 0), or a season TMDB has since restructured.
    const known = seasons([1, 13], [2, 13]);

    expect(await computeNextEpisode(SOPRANOS, 1, 0, 3, known)).toEqual({ season: 0, episode: 4 });
  });

  it("rolls over when the watched episode is past TMDB's count for the season", async () => {
    // TMDB says 13 and the viewer is on 14 — a stale count, or a numbering the
    // two disagree about. Rolling into the next season is right either way; the
    // alternative is offering an episode the season is already past.
    const known = seasons([1, 13], [2, 13]);

    expect(await computeNextEpisode(SOPRANOS, 1, 1, 14, known)).toEqual({ season: 2, episode: 1 });
  });

  it("looks the seasons up when the caller has none", async () => {
    getSeasonsForImdbId.mockResolvedValue(seasons([1, 13], [2, 13]));

    expect(await computeNextEpisode(SOPRANOS, 42, 1, 13)).toEqual({ season: 2, episode: 1 });
    expect(getSeasonsForImdbId).toHaveBeenCalledWith(SOPRANOS, 42);
  });

  it("does not look them up when the caller passes them", async () => {
    // The reason `knownSeasons` exists: a failed TMDB lookup is not cached, so a
    // caller that already paid for one would otherwise pay for a second.
    await computeNextEpisode(SOPRANOS, 42, 1, 1, seasons([1, 13]));

    expect(getSeasonsForImdbId).not.toHaveBeenCalled();
  });

  it("treats an empty passed-in list as known-empty, not as absent", async () => {
    await computeNextEpisode(SOPRANOS, 42, 1, 1, []);

    expect(getSeasonsForImdbId).not.toHaveBeenCalled();
  });
});
