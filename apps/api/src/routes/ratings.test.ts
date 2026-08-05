import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const prismaMock = {
  rating: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn() },
};

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: ratingsRoutes } = await import("./ratings.js");
  const app = Fastify();
  await app.register(ratingsRoutes);
  await app.ready();
  return app;
};

const row = (over: Record<string, unknown> = {}) => ({
  imdbId: "tt1",
  type: "movie",
  season: 0,
  episode: 0,
  rating: 8,
  note: null,
  ratedAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

describe("ratings routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("season ratings", () => {
    it("stores a season rating under its own type, keyed by the season number", async () => {
      prismaMock.rating.upsert.mockResolvedValue(row({ type: "season", imdbId: "tt2", season: 3, rating: 9 }));
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/ratings",
        payload: { imdbId: "tt2", type: "season", season: 3, rating: 9 },
      });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.rating.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            profileId_type_imdbId_season_episode: {
              profileId: PROFILE_ID,
              type: "season",
              imdbId: "tt2",
              season: 3,
              episode: 0,
            },
          },
        })
      );
      expect(res.json().rating).toMatchObject({ type: "season", season: 3, rating: 9 });
      await app.close();
    });

    it("keeps a Specials rating apart from the show's own rating", async () => {
      // Season 0 is Specials. Were season ratings stored as series rows
      // carrying a season number, this would overwrite the rating for the show
      // itself — the reason `season` is a type of its own.
      prismaMock.rating.upsert.mockResolvedValue(row({ type: "season", imdbId: "tt2", season: 0, rating: 5 }));
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/ratings",
        payload: { imdbId: "tt2", type: "season", season: 0, rating: 5 },
      });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.rating.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            profileId_type_imdbId_season_episode: {
              profileId: PROFILE_ID,
              type: "season",
              imdbId: "tt2",
              season: 0,
              episode: 0,
            },
          },
        })
      );
      await app.close();
    });

    it("rejects a season rating with no season number", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/ratings",
        payload: { imdbId: "tt2", type: "season", rating: 9 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("season must be a non-negative integer");
      expect(prismaMock.rating.upsert).not.toHaveBeenCalled();
      await app.close();
    });

    it("reads and deletes a season rating by its season number", async () => {
      prismaMock.rating.findUnique.mockResolvedValue(row({ type: "season", imdbId: "tt2", season: 2, rating: 7 }));
      prismaMock.rating.delete.mockResolvedValue({});
      const app = await buildApp();

      const read = await app.inject({ method: "GET", url: "/ratings/season/tt2?season=2" });
      expect(read.statusCode).toBe(200);
      expect(read.json().rating).toMatchObject({ type: "season", season: 2 });

      const removed = await app.inject({ method: "DELETE", url: "/ratings/season/tt2?season=2" });
      expect(removed.statusCode).toBe(204);
      expect(prismaMock.rating.delete).toHaveBeenCalledWith({
        where: {
          profileId_type_imdbId_season_episode: {
            profileId: PROFILE_ID,
            type: "season",
            imdbId: "tt2",
            season: 2,
            episode: 0,
          },
        },
      });
      await app.close();
    });

    it("names season alongside the other types when the type is unknown", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/ratings/decade/tt2" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("type must be one of: movie, series, season, episode");
      await app.close();
    });
  });

  describe("GET /ratings", () => {
    it("returns every rating for one title, unlimited, when filtering by imdbId", async () => {
      prismaMock.rating.findMany.mockResolvedValue([
        row({ type: "series", imdbId: "tt2" }),
        row({ type: "season", imdbId: "tt2", season: 1 }),
        row({ type: "episode", imdbId: "tt2", season: 1, episode: 4 }),
      ]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/ratings?imdbId=tt2" });

      expect(res.statusCode).toBe(200);
      // No `take`: a long-running show's oldest-rated episodes must not fall
      // off the end of the seasons panel.
      expect(prismaMock.rating.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { profileId: PROFILE_ID, imdbId: "tt2" } })
      );
      expect(prismaMock.rating.findMany.mock.calls[0][0]).not.toHaveProperty("take");
      expect(res.json().ratings).toHaveLength(3);
      await app.close();
    });

    it("still caps the unfiltered list", async () => {
      prismaMock.rating.findMany.mockResolvedValue([]);
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/ratings" });

      expect(prismaMock.rating.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
      await app.close();
    });
  });
});
