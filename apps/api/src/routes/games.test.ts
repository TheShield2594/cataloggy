import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { P2002 } from "../lib/test-fixtures/prisma-errors.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const GAME_ID = "22222222-2222-4222-8222-222222222222";

const prismaMock = {
  game: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
};

const searchGames = vi.fn();
const getIgdb = vi.fn();

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/igdb-client.js", () => ({ getIgdb: () => getIgdb() }));
vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: gamesRoutes } = await import("./games.js");
  const app = Fastify();
  await app.register(gamesRoutes);
  await app.ready();
  return app;
};

const gameRow = (over: Record<string, unknown> = {}) => ({
  id: GAME_ID,
  profileId: PROFILE_ID,
  igdbId: 1234,
  title: "Hollow Knight",
  coverUrl: null,
  releaseDate: null,
  genres: [],
  rating: null,
  notes: null,
  finished: false,
  finishedAt: null,
  playtimeMinutes: 0,
  lastPlayedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

/** The orderBy the route handed to Prisma for the current request. */
const orderBy = () => prismaMock.game.findMany.mock.calls[0][0].orderBy;

describe("games routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getIgdb.mockReturnValue({ searchGames });
    searchGames.mockResolvedValue([]);
    prismaMock.game.findMany.mockResolvedValue([]);
  });

  describe("GET /games", () => {
    it("sorts by last played by default, with nulls last", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games" });

      expect(res.statusCode).toBe(200);
      expect(orderBy()[0]).toEqual({ lastPlayedAt: { sort: "desc", nulls: "last" } });
      await app.close();
    });

    it("sorts by playtime when asked", async () => {
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/games?sort=playtime" });

      expect(orderBy()[0]).toEqual({ playtimeMinutes: "desc" });
      await app.close();
    });

    it("sorts by rating with unrated games last", async () => {
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/games?sort=rating" });

      expect(orderBy()[0]).toEqual({ rating: { sort: "desc", nulls: "last" } });
      await app.close();
    });

    it("rejects an unknown sort rather than silently defaulting", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games?sort=alphabetical" });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.game.findMany).not.toHaveBeenCalled();
      await app.close();
    });

    it("only returns the calling profile's games", async () => {
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/games" });

      expect(prismaMock.game.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { profileId: PROFILE_ID } })
      );
      await app.close();
    });
  });

  describe("GET /games/search", () => {
    it("marks results already in the library", async () => {
      searchGames.mockResolvedValue([{ igdbId: 1, title: "A" }, { igdbId: 2, title: "B" }]);
      prismaMock.game.findMany.mockResolvedValue([{ igdbId: 2 }]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games/search?q=hollow" });

      expect(res.statusCode).toBe(200);
      expect(res.json().results).toEqual([
        expect.objectContaining({ igdbId: 1, inLibrary: false }),
        expect.objectContaining({ igdbId: 2, inLibrary: true }),
      ]);
      await app.close();
    });

    it("rejects a blank query", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games/search?q=%20" });

      expect(res.statusCode).toBe(400);
      expect(getIgdb).not.toHaveBeenCalled();
      await app.close();
    });

    it("returns 500 when IGDB credentials are missing", async () => {
      getIgdb.mockImplementation(() => {
        throw new Error("TWITCH_CLIENT_ID is not set");
      });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games/search?q=hollow" });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toMatch(/not configured/i);
      await app.close();
    });

    it("returns 502 when IGDB itself fails", async () => {
      searchGames.mockRejectedValue(new Error("503"));
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games/search?q=hollow" });

      expect(res.statusCode).toBe(502);
      await app.close();
    });
  });

  describe("POST /games", () => {
    it("adds a game to the library", async () => {
      prismaMock.game.create.mockResolvedValue(gameRow());
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/games",
        payload: { igdbId: 1234, title: "  Hollow Knight  ", genres: ["Metroidvania"] },
      });

      expect(res.statusCode).toBe(201);
      expect(prismaMock.game.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          profileId: PROFILE_ID,
          igdbId: 1234,
          title: "Hollow Knight",
          genres: ["Metroidvania"],
        }),
      });
      await app.close();
    });

    it("returns 409 when the game is already in the library", async () => {
      prismaMock.game.create.mockRejectedValue(P2002);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/games",
        payload: { igdbId: 1234, title: "Hollow Knight" },
      });

      expect(res.statusCode).toBe(409);
      await app.close();
    });

    it("rejects a non-integer igdbId", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/games",
        payload: { igdbId: "1234", title: "Hollow Knight" },
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("rejects an unparseable release date", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/games",
        payload: { igdbId: 1, title: "A", releaseDate: "not-a-date" },
      });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.game.create).not.toHaveBeenCalled();
      await app.close();
    });

    it("rejects genres that are not all strings", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/games",
        payload: { igdbId: 1, title: "A", genres: ["ok", 7] },
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("PATCH /games/:id", () => {
    it("stamps a finish date when a game is marked finished", async () => {
      prismaMock.game.findFirst.mockResolvedValue(gameRow());
      prismaMock.game.update.mockResolvedValue(gameRow({ finished: true }));
      const app = await buildApp();

      const res = await app.inject({
        method: "PATCH",
        url: `/games/${GAME_ID}`,
        payload: { finished: true },
      });

      expect(res.statusCode).toBe(200);
      const data = prismaMock.game.update.mock.calls[0][0].data;
      expect(data.finished).toBe(true);
      expect(data.finishedAt).toBeInstanceOf(Date);
      await app.close();
    });

    it("keeps an existing finish date rather than moving it to today", async () => {
      const original = new Date("2025-06-01T00:00:00Z");
      prismaMock.game.findFirst.mockResolvedValue(gameRow({ finishedAt: original }));
      prismaMock.game.update.mockResolvedValue(gameRow());
      const app = await buildApp();

      await app.inject({ method: "PATCH", url: `/games/${GAME_ID}`, payload: { finished: true } });

      expect(prismaMock.game.update.mock.calls[0][0].data.finishedAt).toBe(original);
      await app.close();
    });

    it("clears the finish date when a game is un-marked", async () => {
      prismaMock.game.findFirst.mockResolvedValue(gameRow({ finished: true, finishedAt: new Date() }));
      prismaMock.game.update.mockResolvedValue(gameRow());
      const app = await buildApp();

      await app.inject({ method: "PATCH", url: `/games/${GAME_ID}`, payload: { finished: false } });

      expect(prismaMock.game.update.mock.calls[0][0].data.finishedAt).toBeNull();
      await app.close();
    });

    it("lets an explicit finishedAt win over the automatic stamp", async () => {
      prismaMock.game.findFirst.mockResolvedValue(gameRow());
      prismaMock.game.update.mockResolvedValue(gameRow());
      const app = await buildApp();

      await app.inject({
        method: "PATCH",
        url: `/games/${GAME_ID}`,
        payload: { finished: true, finishedAt: "2025-03-04T00:00:00Z" },
      });

      expect(prismaMock.game.update.mock.calls[0][0].data.finishedAt).toEqual(
        new Date("2025-03-04T00:00:00Z")
      );
      await app.close();
    });

    it("accepts null to clear a rating", async () => {
      prismaMock.game.findFirst.mockResolvedValue(gameRow({ rating: 8 }));
      prismaMock.game.update.mockResolvedValue(gameRow());
      const app = await buildApp();

      const res = await app.inject({
        method: "PATCH",
        url: `/games/${GAME_ID}`,
        payload: { rating: null },
      });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.game.update.mock.calls[0][0].data.rating).toBeNull();
      await app.close();
    });

    it("rejects a rating outside 1–10", async () => {
      prismaMock.game.findFirst.mockResolvedValue(gameRow());
      const app = await buildApp();

      const res = await app.inject({ method: "PATCH", url: `/games/${GAME_ID}`, payload: { rating: 11 } });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.game.update).not.toHaveBeenCalled();
      await app.close();
    });

    it("404s on another profile's game", async () => {
      prismaMock.game.findFirst.mockResolvedValue(null);
      const app = await buildApp();

      const res = await app.inject({ method: "PATCH", url: `/games/${GAME_ID}`, payload: { rating: 5 } });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it("rejects an id that is not a UUID", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "PATCH", url: "/games/abc", payload: { rating: 5 } });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.game.findFirst).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe("DELETE /games/:id", () => {
    it("removes a game the profile owns", async () => {
      prismaMock.game.findFirst.mockResolvedValue(gameRow());
      prismaMock.game.delete.mockResolvedValue(gameRow());
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/games/${GAME_ID}` });

      expect(res.statusCode).toBe(204);
      expect(prismaMock.game.delete).toHaveBeenCalledWith({ where: { id: GAME_ID } });
      await app.close();
    });

    it("404s on another profile's game", async () => {
      prismaMock.game.findFirst.mockResolvedValue(null);
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/games/${GAME_ID}` });

      expect(res.statusCode).toBe(404);
      expect(prismaMock.game.delete).not.toHaveBeenCalled();
      await app.close();
    });
  });
});
