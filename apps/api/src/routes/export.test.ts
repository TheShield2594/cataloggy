import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";
import { MAX_IMPORT_ROWS } from "../lib/import-validation.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const prismaMock = {
  profile: { findUnique: vi.fn() },
  list: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  watchEvent: { findMany: vi.fn(), update: vi.fn(), createMany: vi.fn() },
  seriesProgress: { findMany: vi.fn() },
  rating: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  listItem: { createMany: vi.fn() },
  playbackProgress: { findMany: vi.fn() },
};

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const watchlistMock = { getDefaultWatchlist: vi.fn() };
vi.mock("../lib/watchlist.js", () => watchlistMock);

const seriesProgressLibMock = {
  upsertSeriesProgressIfNewer: vi.fn(),
  batchUpsertSeriesProgressIfNewer: vi.fn(),
};
vi.mock("../lib/series-progress.js", () => seriesProgressLibMock);

// The forward-only restore is the library's to prove, against a real database
// (playback.int.test.ts). Here it only has to receive what validation let through.
const playbackLibMock = { importPlaybackProgress: vi.fn() };
vi.mock("../lib/playback.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/playback.js")>()),
  ...playbackLibMock,
}));

const resetMocks = () => {
  vi.clearAllMocks();
  prismaMock.profile.findUnique.mockResolvedValue({ name: "Default" });
  prismaMock.list.findMany.mockResolvedValue([]);
  prismaMock.watchEvent.findMany.mockResolvedValue([]);
  // Mirrors a clean insert: every row asked for lands. Tests that care about the
  // skipDuplicates path override this to report fewer.
  prismaMock.watchEvent.createMany.mockImplementation(({ data }: { data: unknown[] }) => ({ count: data.length }));
  prismaMock.listItem.createMany.mockResolvedValue({ count: 0 });
  prismaMock.seriesProgress.findMany.mockResolvedValue([]);
  prismaMock.rating.findMany.mockResolvedValue([]);
  prismaMock.rating.createMany.mockResolvedValue({ count: 0 });
  prismaMock.rating.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.playbackProgress.findMany.mockResolvedValue([]);
  playbackLibMock.importPlaybackProgress.mockImplementation(async (_profileId: string, rows: unknown[]) => rows.length);
};

// `bodyLimit` mirrors the configurable ceiling index.ts sets from
// MAX_BODY_SIZE_MB; the row caps below it only come into play once a
// deployment has raised the byte ceiling enough to fit that many rows.
const buildApp = (bodyLimit?: number): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./export.js"), bodyLimit ? { bodyLimit } : {});

describe("export routes", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("POST /import — version validation", () => {
    it("rejects a payload with no version field", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/import", payload: { lists: [] } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(expect.objectContaining({ error: expect.stringContaining("version") }));
    });

    it("rejects a payload with a mismatched version", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/import", payload: { version: 99, lists: [] } });
      expect(response.statusCode).toBe(400);
    });

    it("accepts a payload with the correct version and an empty body otherwise", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/import", payload: { version: 1 } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(
        expect.objectContaining({ status: "imported", summary: { lists: 0, listItems: 0, watchEvents: 0, seriesProgress: 0, ratings: 0, playback: 0 } })
      );
    });
  });

  describe("POST /import — watch event dedup", () => {
    it("creates a watch event when none exists yet for that day", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/import",
        payload: {
          version: 1,
          watchEvents: [
            { type: "movie", imdbId: "tt1", watchedAt: "2024-01-01T00:00:00Z", plays: 1 },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.watchEvent.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ imdbId: "tt1", type: "movie", plays: 1 })],
        skipDuplicates: true,
      });
      expect(response.json().summary.watchEvents).toBe(1);
    });

    it("increments plays for a duplicate watch event instead of creating a new row", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([
        {
          id: "existing-1",
          type: "movie",
          imdbId: "tt1",
          seriesImdbId: null,
          season: null,
          episode: null,
          watchedAt: new Date("2024-01-01T00:00:00Z"),
        },
      ]);
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/import",
        payload: {
          version: 1,
          watchEvents: [{ type: "movie", imdbId: "tt1", watchedAt: "2024-01-01T00:00:00Z", plays: 2 }],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.watchEvent.createMany).not.toHaveBeenCalled();
      expect(prismaMock.watchEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "existing-1" }, data: { plays: { increment: 2 } } })
      );
    });

    it("skips a watch event entry with an invalid date", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/import",
        payload: { version: 1, watchEvents: [{ type: "movie", imdbId: "tt1", watchedAt: "not-a-date" }] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().summary.watchEvents).toBe(0);
      expect(prismaMock.watchEvent.createMany).not.toHaveBeenCalled();
    });

    it("skips a watch event entry with an invalid type", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/import",
        payload: { version: 1, watchEvents: [{ type: "bogus", imdbId: "tt1", watchedAt: "2024-01-01T00:00:00Z" }] },
      });

      expect(response.json().summary.watchEvents).toBe(0);
    });
  });

  describe("POST /import/csv — CSV parsing", () => {
    it("rejects when csv field is missing", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: {} });
      expect(response.statusCode).toBe(400);
    });

    it("rejects when the required header columns are missing", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/import/csv",
        payload: { csv: "foo,bar\n1,2" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("imports a simple movie row", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/import/csv",
        payload: { csv: "imdbId,type,watchedAt\ntt1,movie,2024-01-01T00:00:00Z" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().summary).toEqual({ imported: 1, skipped: 0 });
      expect(prismaMock.watchEvent.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ imdbId: "tt1", type: "movie" })],
        skipDuplicates: true,
      });
    });

    it("imports a quoted field", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();

      const csv = 'imdbId,type,watchedAt\n"tt1",movie,2024-01-01T00:00:00Z';
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.watchEvent.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ imdbId: "tt1" })],
        skipDuplicates: true,
      });
    });

    it("skips rows with missing required fields and counts them", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();

      const csv = "imdbId,type,watchedAt\n,movie,2024-01-01T00:00:00Z\ntt2,movie,2024-01-02T00:00:00Z";
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.json().summary).toEqual({ imported: 1, skipped: 1 });
    });

    it("skips rows with an invalid type", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();

      const csv = "imdbId,type,watchedAt\ntt1,bogus,2024-01-01T00:00:00Z";
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.json().summary).toEqual({ imported: 0, skipped: 1 });
    });

    it("skips blank lines without counting them as imported or skipped", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([]);
      const app = await buildApp();

      const csv = "imdbId,type,watchedAt\ntt1,movie,2024-01-01T00:00:00Z\n\n";
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.json().summary).toEqual({ imported: 1, skipped: 0 });
    });

    it("sets seriesImdbId for episode rows and increments plays on a duplicate", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([
        {
          id: "existing-ep",
          type: "episode",
          imdbId: "tt900",
          seriesImdbId: "tt900",
          season: 1,
          episode: 2,
          watchedAt: new Date("2024-01-01T00:00:00Z"),
        },
      ]);
      const app = await buildApp();

      const csv = "imdbId,type,season,episode,watchedAt\ntt900,episode,1,2,2024-01-01T00:00:00Z";
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.watchEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "existing-ep" }, data: { plays: { increment: 1 } } })
      );
    });

    it("returns 200 with an empty summary when the CSV has only a header row", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/import/csv",
        payload: { csv: "imdbId,type,watchedAt" },
      });
      // header parses, but there are no data rows to import — should be empty summary, not a crash
      expect(response.statusCode).toBe(200);
      expect(response.json().summary).toEqual({ imported: 0, skipped: 0 });
    });
  });

  describe("POST /import — input validation", () => {
    it("survives a null element in every array instead of crashing", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/import",
        payload: {
          version: 1,
          lists: [null, "nope", 7],
          watchEvents: [null],
          seriesProgress: [null],
          ratings: [null],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().summary).toEqual({
        lists: 0,
        listItems: 0,
        watchEvents: 0,
        seriesProgress: 0,
        ratings: 0,
        playback: 0,
      });
    });

    it("skips rows whose imdbId isn't an IMDb id", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/import",
        payload: {
          version: 1,
          lists: [{ name: "Faves", kind: "custom", items: [{ type: "movie", imdbId: "../../etc/passwd" }] }],
          watchEvents: [{ type: "movie", imdbId: "not-an-id", watchedAt: "2024-01-01T00:00:00Z" }],
          seriesProgress: [
            { seriesImdbId: "nope", lastSeason: 1, lastEpisode: 1, lastWatchedAt: "2024-01-01T00:00:00Z" },
          ],
          ratings: [{ imdbId: "42", type: "movie", rating: 8, ratedAt: "2024-01-01T00:00:00Z" }],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().summary).toEqual(
        expect.objectContaining({ listItems: 0, watchEvents: 0, seriesProgress: 0, ratings: 0 })
      );
      expect(prismaMock.listItem.createMany).not.toHaveBeenCalled();
      expect(prismaMock.rating.createMany).not.toHaveBeenCalled();
    });

    it("skips a season/episode that would overflow the 32-bit column", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/import",
        payload: {
          version: 1,
          watchEvents: [
            { type: "episode", imdbId: "tt1", season: 1e20, episode: 1, watchedAt: "2024-01-01T00:00:00Z" },
          ],
          seriesProgress: [
            { seriesImdbId: "tt1", lastSeason: 1e20, lastEpisode: 1, lastWatchedAt: "2024-01-01T00:00:00Z" },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().summary).toEqual(
        expect.objectContaining({ watchEvents: 0, seriesProgress: 0 })
      );
    });

    it("skips a rating outside the 0-10 scale", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/import",
        payload: {
          version: 1,
          ratings: [
            { imdbId: "tt1", type: "movie", rating: 1e20, ratedAt: "2024-01-01T00:00:00Z" },
            { imdbId: "tt2", type: "movie", rating: -5, ratedAt: "2024-01-01T00:00:00Z" },
            { imdbId: "tt3", type: "movie", rating: 7.5, ratedAt: "2024-01-01T00:00:00Z" },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().summary.ratings).toBe(1);
      expect(prismaMock.rating.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ imdbId: "tt3", rating: 7.5 })],
        })
      );
    });

    it("rejects a collection with more rows than the import limit", async () => {
      const app = await buildApp(256 * 1024 * 1024);
      const watchEvents = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({
        type: "movie",
        imdbId: "tt1",
        watchedAt: "2024-01-01T00:00:00Z",
      }));

      const response = await app.inject({ method: "POST", url: "/import", payload: { version: 1, watchEvents } });

      expect(response.statusCode).toBe(413);
      expect(response.json().code).toBe("too_many_rows");
      expect(prismaMock.watchEvent.createMany).not.toHaveBeenCalled();
    });

    it("writes ratings in one batch rather than one round trip each", async () => {
      const app = await buildApp();
      prismaMock.rating.findMany.mockResolvedValue([
        { type: "movie", imdbId: "tt2", season: 0, episode: 0 },
      ]);

      const response = await app.inject({
        method: "POST",
        url: "/import",
        payload: {
          version: 1,
          ratings: [
            { imdbId: "tt1", type: "movie", rating: 8, ratedAt: "2024-01-01T00:00:00Z" },
            { imdbId: "tt2", type: "movie", rating: 9, ratedAt: "2024-01-01T00:00:00Z" },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      // One insert for the new rating, one update for the one that existed.
      expect(prismaMock.rating.createMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.rating.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [expect.objectContaining({ imdbId: "tt1" })] })
      );
      expect(prismaMock.rating.updateMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.rating.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ imdbId: "tt2" }), data: expect.objectContaining({ rating: 9 }) })
      );
    });
  });

  describe("POST /import — resume points", () => {
    const point = (over: Record<string, unknown> = {}) => ({
      type: "movie",
      imdbId: "tt0111161",
      season: null,
      episode: null,
      progress: 40,
      positionSeconds: 3_400,
      durationSeconds: 8_520,
      pausedAt: "2026-10-20T20:15:00.000Z",
      ...over,
    });
    const importPlayback = async (playback: unknown[]) => {
      const app = await buildApp();
      return app.inject({ method: "POST", url: "/import", payload: { version: 1, playback } });
    };
    const passedRows = () => playbackLibMock.importPlaybackProgress.mock.calls[0]?.[1] as unknown[];

    it("hands valid points to the forward-only restore and reports what it wrote", async () => {
      playbackLibMock.importPlaybackProgress.mockResolvedValueOnce(1);
      const response = await importPlayback([
        point(),
        point({ type: "episode", imdbId: "tt0141842", season: 2, episode: 7, progress: 12.5 }),
      ]);

      expect(response.statusCode).toBe(200);
      // What was written, not what was read: the restore skips points that are
      // behind the profile, and the count says so.
      expect(response.json().summary.playback).toBe(1);
      expect(playbackLibMock.importPlaybackProgress).toHaveBeenCalledWith(PROFILE_ID, [
        {
          target: { type: "movie", imdbId: "tt0111161", season: null, episode: null },
          progress: 40,
          positionSeconds: 3_400,
          durationSeconds: 8_520,
          pausedAt: new Date("2026-10-20T20:15:00.000Z"),
        },
        expect.objectContaining({
          target: { type: "episode", imdbId: "tt0141842", season: 2, episode: 7 },
          progress: 12.5,
        }),
      ]);
    });

    it.each([
      ["a non-IMDb id", point({ imdbId: "../etc" })],
      ["an unknown type", point({ type: "series" })],
      ["progress over 100", point({ progress: 150 })],
      ["no progress", point({ progress: undefined })],
      ["an unparseable pause time", point({ pausedAt: "yesterday-ish" })],
      ["an episode without numbers", point({ type: "episode", season: 2, episode: null })],
      ["an episode past the 32-bit column", point({ type: "episode", season: 2, episode: 2 ** 40 })],
    ])("drops a point with %s", async (_label, row) => {
      await importPlayback([row]);
      expect(passedRows()).toEqual([]);
    });

    it("keeps a point whose seconds are unusable, without the seconds", async () => {
      await importPlayback([
        point({ positionSeconds: 9_000, durationSeconds: 100 }),
        point({ imdbId: "tt0068646", positionSeconds: -5 }),
      ]);

      expect(passedRows()).toEqual([
        expect.objectContaining({ positionSeconds: null, durationSeconds: null, progress: 40 }),
        expect.objectContaining({ positionSeconds: null, durationSeconds: 8_520 }),
      ]);
    });

    it("ignores season and episode on a film", async () => {
      await importPlayback([point({ season: 3, episode: 4 })]);
      expect(passedRows()).toEqual([expect.objectContaining({ target: expect.objectContaining({ season: null, episode: null }) })]);
    });

    it("caps the collection like every other, before any of it is read", async () => {
      const app = await buildApp(512 * 1024 * 1024);
      const response = await app.inject({
        method: "POST",
        url: "/import",
        payload: { version: 1, playback: new Array(MAX_IMPORT_ROWS + 1).fill(0) },
      });

      expect(response.statusCode).toBe(413);
      expect(response.json().error).toMatch(/resume points/);
      expect(playbackLibMock.importPlaybackProgress).not.toHaveBeenCalled();
    });
  });

  describe("POST /import/csv — input validation", () => {
    it("skips a row whose imdbId isn't an IMDb id", async () => {
      const app = await buildApp();
      const csv = "imdbId,type,watchedAt\nnot-an-id,movie,2024-01-01T00:00:00Z";
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.json().summary).toEqual({ imported: 0, skipped: 1 });
    });

    it("skips a row whose season would overflow the column", async () => {
      const app = await buildApp();
      const csv = "imdbId,type,season,episode,watchedAt\ntt1,episode,1e20,1,2024-01-01T00:00:00Z";
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.json().summary).toEqual({ imported: 0, skipped: 1 });
    });
  });

  describe("parseCsv", () => {
    it("keeps commas and escaped quotes inside a quoted field", async () => {
      const { parseCsv } = await import("./export.js");
      expect(parseCsv('a,b\n"x,y","he said ""hi"""')).toEqual([
        ["a", "b"],
        ["x,y", 'he said "hi"'],
      ]);
    });
  });

  describe("GET /export", () => {
    it("returns export payload with the current version", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/export" });
      expect(response.statusCode).toBe(200);
      expect(response.json().version).toBe(1);
    });

    it("carries the profile's resume points", async () => {
      prismaMock.playbackProgress.findMany.mockResolvedValue([
        {
          id: "p1",
          key: "episode:tt0141842:2:7",
          type: "episode",
          imdbId: "tt0141842",
          season: 2,
          episode: 7,
          progress: 40,
          positionSeconds: 1_130,
          durationSeconds: 2_832,
          pausedAt: new Date("2026-10-20T20:15:00.000Z"),
          profileId: PROFILE_ID,
        },
      ]);
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/export" });

      // No row id, key or profile: those are this database's, and an import
      // derives its own.
      expect(response.json().playback).toEqual([
        {
          type: "episode",
          imdbId: "tt0141842",
          season: 2,
          episode: 7,
          progress: 40,
          positionSeconds: 1_130,
          durationSeconds: 2_832,
          pausedAt: "2026-10-20T20:15:00.000Z",
        },
      ]);
    });
  });
});
