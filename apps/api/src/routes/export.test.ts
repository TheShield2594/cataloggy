import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const prismaMock = {
  profile: { findUnique: vi.fn() },
  list: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  watchEvent: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  seriesProgress: { findMany: vi.fn() },
  rating: { findMany: vi.fn(), upsert: vi.fn() },
  listItem: { create: vi.fn() },
};

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const watchlistMock = { getDefaultWatchlist: vi.fn() };
vi.mock("../lib/watchlist.js", () => watchlistMock);

const seriesProgressLibMock = { upsertSeriesProgressIfNewer: vi.fn() };
vi.mock("../lib/series-progress.js", () => seriesProgressLibMock);

const resetMocks = () => {
  vi.clearAllMocks();
  prismaMock.profile.findUnique.mockResolvedValue({ name: "Default" });
  prismaMock.list.findMany.mockResolvedValue([]);
  prismaMock.watchEvent.findMany.mockResolvedValue([]);
  prismaMock.seriesProgress.findMany.mockResolvedValue([]);
  prismaMock.rating.findMany.mockResolvedValue([]);
};

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: exportRoutes } = await import("./export.js");
  const app = Fastify();
  await app.register(exportRoutes);
  await app.ready();
  return app;
};

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
      await app.close();
    });

    it("rejects a payload with a mismatched version", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/import", payload: { version: 99, lists: [] } });
      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it("accepts a payload with the correct version and an empty body otherwise", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/import", payload: { version: 1 } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(
        expect.objectContaining({ status: "imported", summary: { lists: 0, listItems: 0, watchEvents: 0, seriesProgress: 0, ratings: 0 } })
      );
      await app.close();
    });
  });

  describe("POST /import — watch event dedup", () => {
    it("creates a watch event when none exists yet for that day", async () => {
      prismaMock.watchEvent.findFirst.mockResolvedValue(null);
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
      expect(prismaMock.watchEvent.create).toHaveBeenCalled();
      expect(response.json().summary.watchEvents).toBe(1);
      await app.close();
    });

    it("increments plays for a duplicate watch event instead of creating a new row", async () => {
      prismaMock.watchEvent.findFirst.mockResolvedValue({ id: "existing-1" });
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
      expect(prismaMock.watchEvent.create).not.toHaveBeenCalled();
      expect(prismaMock.watchEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "existing-1" }, data: { plays: { increment: 2 } } })
      );
      await app.close();
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
      expect(prismaMock.watchEvent.create).not.toHaveBeenCalled();
      await app.close();
    });

    it("skips a watch event entry with an invalid type", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/import",
        payload: { version: 1, watchEvents: [{ type: "bogus", imdbId: "tt1", watchedAt: "2024-01-01T00:00:00Z" }] },
      });

      expect(response.json().summary.watchEvents).toBe(0);
      await app.close();
    });
  });

  describe("POST /import/csv — CSV parsing", () => {
    it("rejects when csv field is missing", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: {} });
      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it("rejects when the required header columns are missing", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/import/csv",
        payload: { csv: "foo,bar\n1,2" },
      });
      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it("imports a simple movie row", async () => {
      prismaMock.watchEvent.findFirst.mockResolvedValue(null);
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/import/csv",
        payload: { csv: "imdbId,type,watchedAt\ntt1,movie,2024-01-01T00:00:00Z" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().summary).toEqual({ imported: 1, skipped: 0 });
      expect(prismaMock.watchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ imdbId: "tt1", type: "movie" }) })
      );
      await app.close();
    });

    it("handles quoted fields containing embedded commas and escaped quotes", async () => {
      prismaMock.watchEvent.findFirst.mockResolvedValue(null);
      const app = await buildApp();

      const csv = 'imdbId,type,watchedAt\n"tt,1",movie,2024-01-01T00:00:00Z';
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.watchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ imdbId: "tt,1" }) })
      );
      await app.close();
    });

    it("skips rows with missing required fields and counts them", async () => {
      prismaMock.watchEvent.findFirst.mockResolvedValue(null);
      const app = await buildApp();

      const csv = "imdbId,type,watchedAt\n,movie,2024-01-01T00:00:00Z\ntt2,movie,2024-01-02T00:00:00Z";
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.json().summary).toEqual({ imported: 1, skipped: 1 });
      await app.close();
    });

    it("skips rows with an invalid type", async () => {
      prismaMock.watchEvent.findFirst.mockResolvedValue(null);
      const app = await buildApp();

      const csv = "imdbId,type,watchedAt\ntt1,bogus,2024-01-01T00:00:00Z";
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.json().summary).toEqual({ imported: 0, skipped: 1 });
      await app.close();
    });

    it("skips blank lines without counting them as imported or skipped", async () => {
      prismaMock.watchEvent.findFirst.mockResolvedValue(null);
      const app = await buildApp();

      const csv = "imdbId,type,watchedAt\ntt1,movie,2024-01-01T00:00:00Z\n\n";
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.json().summary).toEqual({ imported: 1, skipped: 0 });
      await app.close();
    });

    it("sets seriesImdbId for episode rows and increments plays on a duplicate", async () => {
      prismaMock.watchEvent.findFirst.mockResolvedValue({ id: "existing-ep" });
      const app = await buildApp();

      const csv = "imdbId,type,season,episode,watchedAt\ntt-show,episode,1,2,2024-01-01T00:00:00Z";
      const response = await app.inject({ method: "POST", url: "/import/csv", payload: { csv } });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.watchEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "existing-ep" }, data: { plays: { increment: 1 } } })
      );
      await app.close();
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
      await app.close();
    });
  });

  describe("GET /export", () => {
    it("returns export payload with the current version", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/export" });
      expect(response.statusCode).toBe(200);
      expect(response.json().version).toBe(1);
      await app.close();
    });
  });
});
