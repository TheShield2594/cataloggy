import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
// `WatchEvent.id` is a uuid column, so the id used here has to be one — a
// placeholder like "we-1" is a shape the database could never return.
const EVENT_ID = "44444444-4444-4444-8444-444444444444";

const txMock = {
  watchEvent: { findFirst: vi.fn(), delete: vi.fn() },
  seriesProgress: { upsert: vi.fn(), deleteMany: vi.fn() },
};

const prismaMock = {
  watchEvent: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    aggregate: vi.fn(),
    count: vi.fn(),
  },
  metadata: { findMany: vi.fn() },
  rating: { findMany: vi.fn() },
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => unknown) => callback(txMock)),
  $queryRaw: vi.fn(),
};

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const watchEventMock = { recordWatchEvent: vi.fn() };
vi.mock("../lib/watch-event.js", () => watchEventMock);

const buildApp = (): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./watch.js"));

// /watch/stats/detailed runs two aggregate queries against the same mock, so the
// fixtures are dispatched on the SQL text rather than on call order.
const rawQueryText = (query: unknown): string => {
  const strings = (query as { strings?: string[] } | undefined)?.strings;
  return Array.isArray(strings) ? strings.join(" ") : String(query);
};

type EventStatsRow = {
  longest_streak: bigint;
  current_streak: bigint;
  monthly: { month: string; movies: number; episodes: number }[];
};
type MetadataStatsRow = {
  genres: { genre: string; count: number }[];
  top_rated: { imdbId: string; name: string; type: string; rating: number | null; poster: string | null }[];
};

let eventStatsRows: EventStatsRow[] = [];
let metadataStatsRows: MetadataStatsRow[] = [];

const resetMocks = () => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => unknown) => callback(txMock));
  eventStatsRows = [{ longest_streak: 0n, current_streak: 0n, monthly: [] }];
  metadataStatsRows = [{ genres: [], top_rated: [] }];
  prismaMock.$queryRaw.mockImplementation(async (query: unknown) => {
    const text = rawQueryText(query);
    if (text.includes("watched_metadata")) return metadataStatsRows;
    if (text.includes("run_lengths")) return eventStatsRows;
    return [];
  });
  prismaMock.metadata.findMany.mockResolvedValue([]);
  prismaMock.rating.findMany.mockResolvedValue([]);
};

describe("watch routes", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("POST /watch — validation", () => {
    it("rejects an invalid type", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/watch", payload: { type: "bogus", imdbId: "tt1" } });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a missing imdbId", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/watch", payload: { type: "movie" } });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a negative season", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/watch",
        payload: { type: "episode", imdbId: "tt1", season: -1 },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects an invalid watchedAt string", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/watch",
        payload: { type: "movie", imdbId: "tt1", watchedAt: "not-a-date" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a non-string note", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/watch",
        payload: { type: "movie", imdbId: "tt1", note: 42 },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a note longer than the column is meant to hold", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/watch",
        payload: { type: "movie", imdbId: "tt1", note: "x".repeat(2_001) },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/at most 2,000 characters/);
    });
  });

  describe("POST /watch — success", () => {
    it("records a movie watch event and returns 201 when newly created", async () => {
      watchEventMock.recordWatchEvent.mockResolvedValue({
        watchEvent: { id: EVENT_ID, traktHistoryId: null },
        wasCreated: true,
      });

      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/watch",
        payload: { type: "movie", imdbId: "tt1" },
      });

      expect(response.statusCode).toBe(201);
      expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "movie", imdbId: "tt1", source: "manual" })
      );
    });

    it("returns 200 (not 201) when the event already existed (a replay)", async () => {
      watchEventMock.recordWatchEvent.mockResolvedValue({
        watchEvent: { id: EVENT_ID, traktHistoryId: null },
        wasCreated: false,
      });

      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/watch",
        payload: { type: "movie", imdbId: "tt1" },
      });

      expect(response.statusCode).toBe(200);
    });

    it("serializes a bigint traktHistoryId to a string in the response", async () => {
      watchEventMock.recordWatchEvent.mockResolvedValue({
        watchEvent: { id: EVENT_ID, traktHistoryId: 123456789012345n },
        wasCreated: true,
      });

      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/watch", payload: { type: "movie", imdbId: "tt1" } });

      expect(response.json().watchEvent.traktHistoryId).toBe("123456789012345");
    });
  });

  describe("PATCH /watch/:eventId", () => {
    it("404s when the event doesn't belong to this profile", async () => {
      prismaMock.watchEvent.findFirst.mockResolvedValue(null);
      const app = await buildApp();
      const response = await app.inject({ method: "PATCH", url: `/watch/${EVENT_ID}`, payload: { note: "hi" } });
      expect(response.statusCode).toBe(404);
    });

    it("updates the note", async () => {
      prismaMock.watchEvent.findFirst.mockResolvedValue({ id: EVENT_ID, traktHistoryId: null });
      prismaMock.watchEvent.update.mockResolvedValue({ id: EVENT_ID, note: "great episode", traktHistoryId: null });

      const app = await buildApp();
      const response = await app.inject({ method: "PATCH", url: `/watch/${EVENT_ID}`, payload: { note: "great episode" } });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.watchEvent.update).toHaveBeenCalledWith({
        where: { id: EVENT_ID },
        data: { note: "great episode" },
      });
    });

    it("rejects a non-string, non-null note", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "PATCH", url: `/watch/${EVENT_ID}`, payload: { note: 5 } });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a note longer than the column is meant to hold", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "PATCH",
        url: `/watch/${EVENT_ID}`,
        payload: { note: "x".repeat(2_001) },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/at most 2,000 characters/);
      expect(prismaMock.watchEvent.update).not.toHaveBeenCalled();
    });

    it("rejects an eventId that is not a UUID before it reaches the database", async () => {
      // Postgres errors on a malformed value for a uuid column rather than
      // matching nothing, so without the guard this would be a 500.
      const app = await buildApp();
      const response = await app.inject({ method: "PATCH", url: "/watch/we-1", payload: { note: "hi" } });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("eventId must be a valid UUID");
      expect(prismaMock.watchEvent.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /watch/:eventId", () => {
    it("404s when the event doesn't belong to this profile", async () => {
      txMock.watchEvent.findFirst.mockResolvedValue(null);
      const app = await buildApp();
      const response = await app.inject({ method: "DELETE", url: `/watch/${EVENT_ID}` });
      expect(response.statusCode).toBe(404);
    });

    it("deletes a movie watch event without touching series progress", async () => {
      txMock.watchEvent.findFirst.mockResolvedValue({ id: EVENT_ID, type: "movie", seriesImdbId: null });
      const app = await buildApp();
      const response = await app.inject({ method: "DELETE", url: `/watch/${EVENT_ID}` });

      expect(response.statusCode).toBe(204);
      expect(txMock.watchEvent.delete).toHaveBeenCalledWith({ where: { id: EVENT_ID } });
      expect(txMock.seriesProgress.upsert).not.toHaveBeenCalled();
      expect(txMock.seriesProgress.deleteMany).not.toHaveBeenCalled();
    });

    it("rewinds series progress to the next-latest episode after deleting an episode event", async () => {
      txMock.watchEvent.findFirst
        .mockResolvedValueOnce({ id: EVENT_ID, type: "episode", seriesImdbId: "tt-series" })
        .mockResolvedValueOnce({ season: 1, episode: 4, watchedAt: new Date("2026-01-01T00:00:00Z") });

      const app = await buildApp();
      const response = await app.inject({ method: "DELETE", url: `/watch/${EVENT_ID}` });

      expect(response.statusCode).toBe(204);
      expect(txMock.seriesProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { profileId_seriesImdbId: { profileId: PROFILE_ID, seriesImdbId: "tt-series" } },
          update: expect.objectContaining({ lastSeason: 1, lastEpisode: 4 }),
        })
      );
      expect(txMock.seriesProgress.deleteMany).not.toHaveBeenCalled();
    });

    it("clears series progress entirely when no earlier episode is left", async () => {
      txMock.watchEvent.findFirst
        .mockResolvedValueOnce({ id: EVENT_ID, type: "episode", seriesImdbId: "tt-series" })
        .mockResolvedValueOnce(null);

      const app = await buildApp();
      const response = await app.inject({ method: "DELETE", url: `/watch/${EVENT_ID}` });

      expect(response.statusCode).toBe(204);
      expect(txMock.seriesProgress.deleteMany).toHaveBeenCalledWith({
        where: { profileId: PROFILE_ID, seriesImdbId: "tt-series" },
      });
      expect(txMock.seriesProgress.upsert).not.toHaveBeenCalled();
    });

    it("rejects an eventId that is not a UUID before opening a transaction", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "DELETE", url: "/watch/we-1" });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("eventId must be a valid UUID");
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("GET /watch/history", () => {
    it("returns an empty list when there is no history", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/history" });
      expect(response.json()).toEqual({ history: [] });
    });

    it("attaches metadata name/poster and serializes traktHistoryId", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([
        { id: EVENT_ID, type: "movie", imdbId: "tt1", seriesImdbId: null, traktHistoryId: 42n },
      ]);
      prismaMock.metadata.findMany.mockResolvedValue([{ imdbId: "tt1", type: "movie", name: "Movie A", poster: "p.jpg" }]);

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/history" });

      expect(response.json().history[0]).toEqual(
        expect.objectContaining({ name: "Movie A", poster: "p.jpg", traktHistoryId: "42" })
      );
    });

    it("clamps an out-of-range limit query param to the 1-200 window", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();
      await app.inject({ method: "GET", url: "/watch/history?limit=9999" });

      expect(prismaMock.watchEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 })
      );
    });

    it("filters by type in the query, so paging doesn't hide older matches", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();
      await app.inject({ method: "GET", url: "/watch/history?type=movie" });

      expect(prismaMock.watchEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ type: "movie" }) })
      );
    });

    it("rejects an unrecognised type rather than answering an unfiltered page", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/history?type=banana" });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/movie, episode/);
      expect(prismaMock.watchEvent.findMany).not.toHaveBeenCalled();
    });

    it.each(["type", "imdbId"])("rejects a repeated %s rather than 500ing on the array", async (field) => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();
      const response = await app.inject({
        method: "GET",
        url: `/watch/history?${field}=movie&${field}=episode`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe(`${field} must be given at most once`);
      expect(prismaMock.watchEvent.findMany).not.toHaveBeenCalled();
    });

    it("treats an empty type as no filter, which is what a cleared UI filter sends", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/history?type=" });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.watchEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.not.objectContaining({ type: expect.anything() }) })
      );
    });
  });

  describe("GET /watch/stats", () => {
    it("aggregates movie/episode counts and plays-this-week", async () => {
      prismaMock.watchEvent.aggregate
        .mockResolvedValueOnce({ _count: 10, _sum: { plays: 15 } })
        .mockResolvedValueOnce({ _count: 20, _sum: { plays: 30 } });
      prismaMock.watchEvent.count.mockResolvedValue(3);

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/stats" });

      expect(response.json()).toEqual({
        totalMovies: 10,
        totalEpisodes: 20,
        totalPlays: 45,
        playsThisWeek: 3,
      });
    });
  });

  describe("GET /watch/stats/year/:year", () => {
    it("rejects a malformed year", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/stats/year/abcd" });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a year before 1900", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/stats/year/1899" });
      expect(response.statusCode).toBe(400);
    });

    it("returns zeroed totals for a year with no events", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/stats/year/2026" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(
        expect.objectContaining({ year: 2026, totalMovies: 0, totalEpisodes: 0, totalRuntimeMinutes: 0 })
      );
    });
  });

  describe("GET /watch/stats/detailed", () => {
    it("surfaces the current/longest streak from the raw SQL query", async () => {
      eventStatsRows = [{ longest_streak: 12n, current_streak: 3n, monthly: [] }];

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/stats/detailed" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(
        expect.objectContaining({ longestStreak: 12, currentStreak: 3 })
      );
    });

    it("aggregates in SQL — no per-event or per-metadata rows are pulled into Node", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/stats/detailed" });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
      expect(prismaMock.watchEvent.findMany).not.toHaveBeenCalled();
      expect(prismaMock.metadata.findMany).not.toHaveBeenCalled();
    });

    it("pads the monthly series to 12 buckets and passes SQL rollups through", async () => {
      const now = new Date();
      const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      eventStatsRows = [
        {
          longest_streak: 1n,
          current_streak: 1n,
          monthly: [{ month: thisMonth, movies: 4, episodes: 9 }],
        },
      ];

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/stats/detailed" });
      const body = response.json();

      expect(body.monthly).toHaveLength(12);
      expect(body.monthly.at(-1)).toEqual({ month: thisMonth, movies: 4, episodes: 9 });
      expect(body.monthly[0]).toEqual(expect.objectContaining({ movies: 0, episodes: 0 }));
    });

    it("returns the genre histogram and top-rated list built by Postgres", async () => {
      metadataStatsRows = [
        {
          genres: [{ genre: "Drama", count: 7 }, { genre: "Comedy", count: 2 }],
          top_rated: [
            { imdbId: "tt1", name: "A Film", type: "movie", rating: 8.4, poster: null },
          ],
        },
      ];

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/watch/stats/detailed" });
      const body = response.json();

      expect(body.genreDistribution).toEqual([
        { genre: "Drama", count: 7 },
        { genre: "Comedy", count: 2 },
      ]);
      expect(body.topRated).toEqual([
        { imdbId: "tt1", name: "A Film", type: "movie", rating: 8.4, poster: null },
      ]);
    });
  });
});
