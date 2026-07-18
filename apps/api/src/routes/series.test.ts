import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const prismaMock = {
  kV: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  seriesProgress: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  metadata: { findMany: vi.fn(), findUnique: vi.fn() },
  watchEvent: { groupBy: vi.fn(), findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const nextEpisodeMock = { computeNextEpisode: vi.fn() };
vi.mock("../lib/next-episode.js", () => nextEpisodeMock);

const tmdbClientMock = { getTmdb: vi.fn() };
vi.mock("../lib/tmdb-client.js", () => tmdbClientMock);

const metadataLibMock = { upsertMetadata: vi.fn() };
vi.mock("../lib/metadata.js", () => metadataLibMock);

const seriesProgressLibMock = { upsertSeriesProgressIfNewer: vi.fn() };
vi.mock("../lib/series-progress.js", () => seriesProgressLibMock);

const watchEventLibMock = { recordWatchEvent: vi.fn() };
vi.mock("../lib/watch-event.js", () => watchEventLibMock);

const resetMocks = () => {
  vi.clearAllMocks();
  prismaMock.kV.findMany.mockResolvedValue([]);
};

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: seriesRoutes } = await import("./series.js");
  const app = Fastify();
  await app.register(seriesRoutes);
  await app.ready();
  return app;
};

describe("series routes — completion drops from Continue Watching", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("GET /series/progress", () => {
    it("drops a show once watched episodes reach the total, even if next-episode math disagrees", async () => {
      prismaMock.seriesProgress.findMany.mockResolvedValue([
        {
          seriesImdbId: "tt-office",
          lastSeason: 8,
          lastEpisode: 21,
          lastWatchedAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      prismaMock.metadata.findMany.mockResolvedValue([
        {
          imdbId: "tt-office",
          name: "The Office",
          poster: null,
          background: null,
          totalSeasons: 9,
          totalEpisodes: 186,
          tmdbId: 2316,
        },
      ]);
      // Simulate 186 distinct watched (season, episode) pairs.
      prismaMock.watchEvent.groupBy.mockResolvedValue(
        Array.from({ length: 186 }, (_, i) => ({
          seriesImdbId: "tt-office",
          season: 1,
          episode: i + 1,
          _count: { _all: 1 },
        }))
      );
      // Even though the season-based fallback thinks there's a next episode...
      nextEpisodeMock.computeNextEpisode.mockResolvedValue({ season: 8, episode: 22 });

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/series/progress" });

      expect(response.statusCode).toBe(200);
      expect(response.json().progress).toEqual([]);
      await app.close();
    });

    it("keeps a show with unwatched episodes remaining", async () => {
      prismaMock.seriesProgress.findMany.mockResolvedValue([
        {
          seriesImdbId: "tt-office",
          lastSeason: 8,
          lastEpisode: 10,
          lastWatchedAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      prismaMock.metadata.findMany.mockResolvedValue([
        {
          imdbId: "tt-office",
          name: "The Office",
          poster: null,
          background: null,
          totalSeasons: 9,
          totalEpisodes: 186,
          tmdbId: 2316,
        },
      ]);
      prismaMock.watchEvent.groupBy.mockResolvedValue(
        Array.from({ length: 100 }, (_, i) => ({
          seriesImdbId: "tt-office",
          season: 1,
          episode: i + 1,
          _count: { _all: 1 },
        }))
      );
      nextEpisodeMock.computeNextEpisode.mockResolvedValue({ season: 8, episode: 11 });

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/series/progress" });

      expect(response.statusCode).toBe(200);
      const progress = response.json().progress;
      expect(progress).toHaveLength(1);
      expect(progress[0].nextSeason).toBe(8);
      expect(progress[0].nextEpisode).toBe(11);
      await app.close();
    });
  });

  describe("POST /series/:imdbId/watch-next", () => {
    it("returns 409 once watched episodes reach the total instead of marking a phantom episode", async () => {
      prismaMock.seriesProgress.findUnique.mockResolvedValue({
        seriesImdbId: "tt-office",
        lastSeason: 8,
        lastEpisode: 21,
      });
      prismaMock.metadata.findUnique.mockResolvedValue({ tmdbId: 2316, totalEpisodes: 186 });
      prismaMock.watchEvent.findMany.mockResolvedValue(
        Array.from({ length: 186 }, (_, i) => ({ season: 1, episode: i + 1 }))
      );

      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/series/tt-office/watch-next" });

      expect(response.statusCode).toBe(409);
      expect(prismaMock.watchEvent.create).not.toHaveBeenCalled();
      await app.close();
    });
  });
});
