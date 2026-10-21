import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const ROW_ID = "22222222-2222-4222-8222-222222222222";

const prismaMock = {
  playbackProgress: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  metadata: { findMany: vi.fn() },
};

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const PAUSED_AT = new Date("2026-10-20T20:15:00Z");

const row = (overrides: Record<string, unknown> = {}) => ({
  id: ROW_ID,
  key: "movie:tt0111161",
  type: "movie",
  imdbId: "tt0111161",
  season: null,
  episode: null,
  progress: 42.5,
  positionSeconds: 3_400,
  durationSeconds: 8_520,
  pausedAt: PAUSED_AT,
  profileId: PROFILE_ID,
  ...overrides,
});

const buildApp = (): Promise<FastifyInstance> => buildRouteApp(() => import("./playback.js"));

describe("playback routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.playbackProgress.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) =>
      row(create)
    );
  });

  describe("GET /playback", () => {
    it("lists resume points newest first, with the title's name and poster", async () => {
      prismaMock.playbackProgress.findMany.mockResolvedValue([
        row({ id: ROW_ID, type: "episode", imdbId: "tt0903747", season: 2, episode: 7, key: "episode:tt0903747:2:7" }),
      ]);
      prismaMock.metadata.findMany.mockResolvedValue([
        { imdbId: "tt0903747", name: "Breaking Bad", poster: "https://img/bb.jpg" },
      ]);

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/playback" });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.playbackProgress.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { profileId: PROFILE_ID }, orderBy: { pausedAt: "desc" }, take: 50 })
      );
      expect(response.json()).toEqual({
        playback: [
          {
            id: ROW_ID,
            type: "episode",
            imdbId: "tt0903747",
            season: 2,
            episode: 7,
            progress: 42.5,
            positionSeconds: 3_400,
            durationSeconds: 8_520,
            pausedAt: PAUSED_AT.toISOString(),
            name: "Breaking Bad",
            poster: "https://img/bb.jpg",
          },
        ],
      });
    });

    it("filters by type and caps the limit", async () => {
      prismaMock.playbackProgress.findMany.mockResolvedValue([]);

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/playback?type=movie&limit=9999" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ playback: [] });
      expect(prismaMock.playbackProgress.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { profileId: PROFILE_ID, type: "movie" }, take: 200 })
      );
    });

    it("truncates a fractional limit rather than handing Prisma a fractional take", async () => {
      prismaMock.playbackProgress.findMany.mockResolvedValue([]);

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/playback?limit=1.5" });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.playbackProgress.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
    });

    it("rejects an unknown type rather than returning an unfiltered page", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/playback?type=series" });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /playback/:imdbId", () => {
    it("looks a film up by its key", async () => {
      prismaMock.playbackProgress.findUnique.mockResolvedValue(row());

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/playback/tt0111161" });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.playbackProgress.findUnique).toHaveBeenCalledWith({
        where: { profileId_key: { profileId: PROFILE_ID, key: "movie:tt0111161" } },
      });
      expect(response.json().playback).toMatchObject({ id: ROW_ID, positionSeconds: 3_400 });
    });

    it("looks an episode up by series, season and episode", async () => {
      prismaMock.playbackProgress.findUnique.mockResolvedValue(null);

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/playback/tt0903747?season=2&episode=7" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ playback: null });
      expect(prismaMock.playbackProgress.findUnique).toHaveBeenCalledWith({
        where: { profileId_key: { profileId: PROFILE_ID, key: "episode:tt0903747:2:7" } },
      });
    });

    it("rejects a season without an episode", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/playback/tt0903747?season=2" });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a non-numeric episode", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/playback/tt0903747?season=2&episode=x" });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("PUT /playback", () => {
    it("saves a film's position and works the percentage out from seconds", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "PUT",
        url: "/playback",
        payload: { type: "movie", imdbId: "tt0111161", positionSeconds: 1_800, durationSeconds: 7_200 },
      });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.playbackProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { profileId_key: { profileId: PROFILE_ID, key: "movie:tt0111161" } },
          create: expect.objectContaining({ progress: 25, positionSeconds: 1_800, durationSeconds: 7_200 }),
        })
      );
      expect(response.json().playback).toMatchObject({ progress: 25, positionSeconds: 1_800 });
    });

    it("keys an episode on its series, whichever id the player sent", async () => {
      const app = await buildApp();
      await app.inject({
        method: "PUT",
        url: "/playback",
        payload: {
          type: "episode",
          imdbId: "tt1054724",
          seriesImdbId: "tt0903747",
          season: 2,
          episode: 7,
          progress: 61,
        },
      });

      expect(prismaMock.playbackProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { profileId_key: { profileId: PROFILE_ID, key: "episode:tt0903747:2:7" } },
          create: expect.objectContaining({ imdbId: "tt0903747", season: 2, episode: 7, progress: 61 }),
        })
      );
    });

    it("clears a stale position on a percentage-only save, but keeps the duration", async () => {
      const app = await buildApp();
      await app.inject({ method: "PUT", url: "/playback", payload: { type: "movie", imdbId: "tt1", progress: 60 } });

      const [call] = prismaMock.playbackProgress.upsert.mock.calls[0] as [{ update: Record<string, unknown> }];
      expect(call.update).toMatchObject({ progress: 60, positionSeconds: null });
      expect(call.update).not.toHaveProperty("durationSeconds");
    });

    it("prefers an explicit progress over the one seconds would give", async () => {
      const app = await buildApp();
      await app.inject({
        method: "PUT",
        url: "/playback",
        payload: { type: "movie", imdbId: "tt1", progress: 30, positionSeconds: 10, durationSeconds: 100 },
      });

      expect(prismaMock.playbackProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ progress: 30 }) })
      );
    });

    it.each([
      ["no position at all", { type: "movie", imdbId: "tt1" }],
      ["a position without a duration", { type: "movie", imdbId: "tt1", positionSeconds: 60 }],
      ["an episode without numbers", { type: "episode", imdbId: "tt0903747", progress: 10 }],
      ["a position past the end", { type: "movie", imdbId: "tt1", positionSeconds: 200, durationSeconds: 100 }],
      ["progress over 100", { type: "movie", imdbId: "tt1", progress: 150 }],
      ["a string progress", { type: "movie", imdbId: "tt1", progress: "50" }],
      ["an unknown type", { type: "series", imdbId: "tt1", progress: 10 }],
      ["a blank imdbId", { type: "movie", imdbId: "   ", progress: 10 }],
    ])("rejects %s", async (_label, payload) => {
      const app = await buildApp();
      const response = await app.inject({ method: "PUT", url: "/playback", payload });

      expect(response.statusCode).toBe(400);
      expect(prismaMock.playbackProgress.upsert).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /playback/:id", () => {
    it("deletes the profile's own row", async () => {
      prismaMock.playbackProgress.deleteMany.mockResolvedValue({ count: 1 });

      const app = await buildApp();
      const response = await app.inject({ method: "DELETE", url: `/playback/${ROW_ID}` });

      expect(response.statusCode).toBe(204);
      expect(prismaMock.playbackProgress.deleteMany).toHaveBeenCalledWith({
        where: { id: ROW_ID, profileId: PROFILE_ID },
      });
    });

    it("is a 404 for a row that is not there — or is someone else's", async () => {
      prismaMock.playbackProgress.deleteMany.mockResolvedValue({ count: 0 });

      const app = await buildApp();
      const response = await app.inject({ method: "DELETE", url: `/playback/${ROW_ID}` });
      expect(response.statusCode).toBe(404);
    });

    it("rejects a malformed id before querying", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "DELETE", url: "/playback/tt0111161" });

      expect(response.statusCode).toBe(400);
      expect(prismaMock.playbackProgress.deleteMany).not.toHaveBeenCalled();
    });
  });
});
