import { beforeEach, describe, expect, it, vi } from "vitest";

// What this returns is what a notification says and what the calendar shows, so
// being wrong here is invisible: the app names an episode with total confidence
// and nobody finds out until they go looking for it.

const prismaMock = {
  seriesProgress: { findMany: vi.fn() },
  metadata: { findMany: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const getTmdb = vi.fn();
vi.mock("./tmdb-client.js", () => ({ getTmdb: () => getTmdb() }));

const showDetailsCache = new Map<string, unknown>();
vi.mock("./cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cache.js")>()),
  showDetailsCache: {
    get: (key: string) => showDetailsCache.get(key),
    set: (key: string, value: unknown) => showDetailsCache.set(key, value),
  },
}));

const { getUpcomingEpisodes } = await import("./upcoming-episodes.js");

const PROFILE = "11111111-1111-4111-8111-111111111111";
const SOPRANOS = "tt0141842";
const WIRE = "tt0306414";

/** `daysAhead` is measured from today, so fixtures have to be too. */
const daysFromToday = (days: number): string => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const nextEpisode = (overrides: Record<string, unknown> = {}) => ({
  season_number: 3,
  episode_number: 4,
  name: "Employee of the Month",
  air_date: daysFromToday(3),
  overview: "Something happens.",
  ...overrides,
});

const getShowDetails = vi.fn();

beforeEach(() => {
  showDetailsCache.clear();
  prismaMock.seriesProgress.findMany.mockReset();
  prismaMock.metadata.findMany.mockReset();
  getShowDetails.mockReset();
  getTmdb.mockReset();
  getTmdb.mockResolvedValue({ getLanguage: () => "en-US", getShowDetails });

  prismaMock.seriesProgress.findMany.mockResolvedValue([
    { seriesImdbId: SOPRANOS, lastWatchedAt: new Date("2026-05-02T20:00:00Z") },
  ]);
  prismaMock.metadata.findMany.mockResolvedValue([
    { imdbId: SOPRANOS, tmdbId: 1398, name: "The Sopranos", poster: "/poster.jpg" },
  ]);
  getShowDetails.mockResolvedValue({ nextEpisodeToAir: nextEpisode() });
});

describe("getUpcomingEpisodes", () => {
  it("returns the next episode of a tracked series inside the window", async () => {
    const [episode] = await getUpcomingEpisodes(PROFILE, 7);

    expect(episode).toMatchObject({
      seriesImdbId: SOPRANOS,
      seriesName: "The Sopranos",
      poster: "/poster.jpg",
      season: 3,
      episode: 4,
      episodeName: "Employee of the Month",
      overview: "Something happens.",
    });
  });

  it("asks for nothing when the profile is tracking nothing", async () => {
    prismaMock.seriesProgress.findMany.mockResolvedValue([]);

    expect(await getUpcomingEpisodes(PROFILE, 7)).toEqual([]);
    expect(getTmdb).not.toHaveBeenCalled();
  });

  it("drops an episode airing past the window", async () => {
    getShowDetails.mockResolvedValue({ nextEpisodeToAir: nextEpisode({ air_date: daysFromToday(20) }) });

    expect(await getUpcomingEpisodes(PROFILE, 7)).toEqual([]);
  });

  it("keeps an episode airing today", async () => {
    // The boundary that matters most: "tonight" is the notification people want.
    getShowDetails.mockResolvedValue({ nextEpisodeToAir: nextEpisode({ air_date: daysFromToday(0) }) });

    expect(await getUpcomingEpisodes(PROFILE, 7)).toHaveLength(1);
  });

  it("keeps an episode airing on the last day of the window", async () => {
    getShowDetails.mockResolvedValue({ nextEpisodeToAir: nextEpisode({ air_date: daysFromToday(7) }) });

    expect(await getUpcomingEpisodes(PROFILE, 7)).toHaveLength(1);
  });

  it("drops an episode that already aired", async () => {
    getShowDetails.mockResolvedValue({ nextEpisodeToAir: nextEpisode({ air_date: daysFromToday(-1) }) });

    expect(await getUpcomingEpisodes(PROFILE, 7)).toEqual([]);
  });

  it("drops an unparseable air date rather than passing NaN along", async () => {
    getShowDetails.mockResolvedValue({ nextEpisodeToAir: nextEpisode({ air_date: "soon" }) });

    expect(await getUpcomingEpisodes(PROFILE, 7)).toEqual([]);
  });

  it("skips a series with no next episode announced", async () => {
    getShowDetails.mockResolvedValue({ nextEpisodeToAir: null });

    expect(await getUpcomingEpisodes(PROFILE, 7)).toEqual([]);
  });

  it("skips a series whose metadata carries no TMDB id", async () => {
    prismaMock.metadata.findMany.mockResolvedValue([
      { imdbId: SOPRANOS, tmdbId: null, name: "The Sopranos", poster: null },
    ]);

    expect(await getUpcomingEpisodes(PROFILE, 7)).toEqual([]);
    expect(getShowDetails).not.toHaveBeenCalled();
  });

  it("sorts by air date across series", async () => {
    prismaMock.seriesProgress.findMany.mockResolvedValue([
      { seriesImdbId: SOPRANOS, lastWatchedAt: new Date() },
      { seriesImdbId: WIRE, lastWatchedAt: new Date() },
    ]);
    prismaMock.metadata.findMany.mockResolvedValue([
      { imdbId: SOPRANOS, tmdbId: 1398, name: "The Sopranos", poster: null },
      { imdbId: WIRE, tmdbId: 1438, name: "The Wire", poster: null },
    ]);
    getShowDetails.mockImplementation((tmdbId: number) => ({
      nextEpisodeToAir: nextEpisode({ air_date: daysFromToday(tmdbId === 1398 ? 5 : 2) }),
    }));

    const upcoming = await getUpcomingEpisodes(PROFILE, 7);

    expect(upcoming.map((episode) => episode.seriesName)).toEqual(["The Wire", "The Sopranos"]);
  });

  it("lets one series' failure through without losing the others", async () => {
    prismaMock.seriesProgress.findMany.mockResolvedValue([
      { seriesImdbId: SOPRANOS, lastWatchedAt: new Date() },
      { seriesImdbId: WIRE, lastWatchedAt: new Date() },
    ]);
    prismaMock.metadata.findMany.mockResolvedValue([
      { imdbId: SOPRANOS, tmdbId: 1398, name: "The Sopranos", poster: null },
      { imdbId: WIRE, tmdbId: 1438, name: "The Wire", poster: null },
    ]);
    getShowDetails.mockImplementation((tmdbId: number) => {
      if (tmdbId === 1398) throw new Error("TMDB is having a moment");
      return { nextEpisodeToAir: nextEpisode() };
    });

    const upcoming = await getUpcomingEpisodes(PROFILE, 7);

    expect(upcoming.map((episode) => episode.seriesName)).toEqual(["The Wire"]);
  });

  it("returns nothing when TMDB is not configured at all", async () => {
    getTmdb.mockRejectedValue(new Error("No TMDB API key"));

    expect(await getUpcomingEpisodes(PROFILE, 7)).toEqual([]);
  });

  it("caps how many tracked series it looks at, most recently watched first", async () => {
    prismaMock.seriesProgress.findMany.mockResolvedValue([]);

    await getUpcomingEpisodes(PROFILE, 7, 10);

    expect(prismaMock.seriesProgress.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { lastWatchedAt: "desc" }, take: 10 })
    );
  });

  it("takes every tracked series when the cap is null", async () => {
    prismaMock.seriesProgress.findMany.mockResolvedValue([]);

    await getUpcomingEpisodes(PROFILE, 7, null);

    expect(prismaMock.seriesProgress.findMany.mock.calls[0][0]).not.toHaveProperty("take");
  });

  // The notification job passes no cap, so without this the per-tick TMDB
  // fan-out is the size of the library rather than the part of it still airing.
  it("asks TMDB only about series that can still have another episode", async () => {
    prismaMock.seriesProgress.findMany.mockResolvedValue([
      { seriesImdbId: SOPRANOS, lastWatchedAt: new Date("2026-05-02T20:00:00Z") },
      { seriesImdbId: WIRE, lastWatchedAt: new Date("2026-05-01T20:00:00Z") },
    ]);
    // The Wire is filtered out by the query, so it never comes back here.
    prismaMock.metadata.findMany.mockResolvedValue([
      { imdbId: SOPRANOS, tmdbId: 1398, name: "The Sopranos", poster: "/poster.jpg" },
    ]);

    await getUpcomingEpisodes(PROFILE, 7, null);

    expect(prismaMock.metadata.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tmdbId: { not: null },
          OR: [{ status: null }, { status: { notIn: ["Ended", "Canceled"] } }],
        }),
      })
    );
    expect(getShowDetails).toHaveBeenCalledTimes(1);
    expect(getShowDetails).toHaveBeenCalledWith(1398);
  });

  // A show whose status has not been filled in yet must not be dropped: the
  // cost of being wrong that way is an episode that silently never notifies.
  it("keeps a series whose status is unknown", async () => {
    await getUpcomingEpisodes(PROFILE, 7, null);

    expect(prismaMock.metadata.findMany.mock.calls[0][0].where.OR).toContainEqual({ status: null });
  });

  // Ordered by the progress rows, not by whatever order Postgres returned the
  // metadata in, so the most recently watched shows are still fetched first.
  it("asks about series in most-recently-watched order", async () => {
    prismaMock.seriesProgress.findMany.mockResolvedValue([
      { seriesImdbId: SOPRANOS, lastWatchedAt: new Date("2026-05-02T20:00:00Z") },
      { seriesImdbId: WIRE, lastWatchedAt: new Date("2026-05-01T20:00:00Z") },
    ]);
    prismaMock.metadata.findMany.mockResolvedValue([
      { imdbId: WIRE, tmdbId: 1438, name: "The Wire", poster: null },
      { imdbId: SOPRANOS, tmdbId: 1398, name: "The Sopranos", poster: "/poster.jpg" },
    ]);
    getShowDetails.mockResolvedValue({ nextEpisodeToAir: null });

    await getUpcomingEpisodes(PROFILE, 7, null);

    expect(getShowDetails.mock.calls.map((call) => call[0])).toEqual([1398, 1438]);
  });

  it("does not reach TMDB at all when no tracked series can still air", async () => {
    prismaMock.metadata.findMany.mockResolvedValue([]);

    expect(await getUpcomingEpisodes(PROFILE, 7, null)).toEqual([]);
    expect(getShowDetails).not.toHaveBeenCalled();
  });
});

describe("spoiler protection", () => {
  it("replaces the episode title and drops the synopsis", async () => {
    const [episode] = await getUpcomingEpisodes(PROFILE, 7, 30, true);

    expect(episode).toMatchObject({ episodeName: "Episode 4", overview: null });
    // The numbers themselves are not spoilers — they are how you find it.
    expect(episode).toMatchObject({ season: 3, episode: 4 });
  });

  it("leaves both alone when it is off", async () => {
    const [episode] = await getUpcomingEpisodes(PROFILE, 7, 30, false);

    expect(episode).toMatchObject({
      episodeName: "Employee of the Month",
      overview: "Something happens.",
    });
  });
});

describe("the show-details cache", () => {
  it("asks TMDB once for a series looked up twice", async () => {
    await getUpcomingEpisodes(PROFILE, 7);
    await getUpcomingEpisodes(PROFILE, 7);

    expect(getShowDetails).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed lookup, so an outage does not last for hours", async () => {
    // `getShowDetails` returns null on a fetch or parse error, which is not the
    // same answer as a successful call saying there is no next episode.
    getShowDetails.mockResolvedValueOnce(null);

    await getUpcomingEpisodes(PROFILE, 7);
    getShowDetails.mockResolvedValue({ nextEpisodeToAir: nextEpisode() });
    const upcoming = await getUpcomingEpisodes(PROFILE, 7);

    expect(getShowDetails).toHaveBeenCalledTimes(2);
    expect(upcoming).toHaveLength(1);
  });

  it("keys the cache by language, so switching does not serve the old one", async () => {
    await getUpcomingEpisodes(PROFILE, 7);
    getTmdb.mockResolvedValue({ getLanguage: () => "fr-FR", getShowDetails });

    await getUpcomingEpisodes(PROFILE, 7);

    expect(getShowDetails).toHaveBeenCalledTimes(2);
  });
});
