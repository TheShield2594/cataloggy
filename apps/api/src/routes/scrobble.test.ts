import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const txMock = {
  scrobbleSession: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
};

const prismaMock = {
  scrobbleSession: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  checkIn: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  metadata: { findMany: vi.fn(), findUnique: vi.fn() },
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => unknown) => callback(txMock)),
};

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const watchEventMock = { recordWatchEvent: vi.fn() };
vi.mock("../lib/watch-event.js", () => watchEventMock);

const traktClientMock = { pushTraktScrobble: vi.fn() };
vi.mock("../lib/trakt-client.js", () => traktClientMock);

const resetMocks = () => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => unknown) => callback(txMock));
  watchEventMock.recordWatchEvent.mockResolvedValue({ watchEvent: { id: "we-1" }, wasCreated: true });
  traktClientMock.pushTraktScrobble.mockResolvedValue(null);
};

const buildApp = (): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./scrobble.js"));

describe("scrobble routes", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("POST /scrobble/start — session lifecycle", () => {
    it("rejects an invalid type", async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/scrobble/start",
        payload: { type: "bogus", imdbId: "tt1" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a missing imdbId", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/scrobble/start", payload: { type: "movie" } });
      expect(response.statusCode).toBe(400);
    });

    it("creates a new session when none exists and returns 201", async () => {
      txMock.scrobbleSession.findFirst.mockResolvedValue(null);
      txMock.scrobbleSession.create.mockResolvedValue({ id: "s1", status: "playing", progress: 0 });

      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/scrobble/start",
        payload: { type: "movie", imdbId: "tt1", progress: 10 },
      });

      expect(response.statusCode).toBe(201);
      expect(traktClientMock.pushTraktScrobble).toHaveBeenCalledWith(
        "start",
        expect.objectContaining({ imdbId: "tt1" }),
        expect.anything()
      );
    });

    it("reuses an existing playing/paused session instead of creating a new one", async () => {
      txMock.scrobbleSession.findFirst.mockResolvedValue({ id: "s1", status: "paused" });
      txMock.scrobbleSession.update.mockResolvedValue({ id: "s1", status: "playing", progress: 50 });

      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/scrobble/start",
        payload: { type: "movie", imdbId: "tt1", progress: 50 },
      });

      expect(response.statusCode).toBe(200);
      expect(txMock.scrobbleSession.create).not.toHaveBeenCalled();
      expect(txMock.scrobbleSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "s1" }, data: { status: "playing", progress: 50 } })
      );
    });

    it("does not re-push to Trakt when resuming a session that was already playing", async () => {
      txMock.scrobbleSession.findFirst.mockResolvedValue({ id: "s1", status: "playing" });
      txMock.scrobbleSession.update.mockResolvedValue({ id: "s1", status: "playing", progress: 50 });

      const app = await buildApp();
      await app.inject({ method: "POST", url: "/scrobble/start", payload: { type: "movie", imdbId: "tt1", progress: 50 } });

      expect(traktClientMock.pushTraktScrobble).not.toHaveBeenCalled();
    });

    it("clamps progress to the 0-100 range", async () => {
      txMock.scrobbleSession.findFirst.mockResolvedValue(null);
      txMock.scrobbleSession.create.mockResolvedValue({ id: "s1", status: "playing", progress: 100 });

      const app = await buildApp();
      await app.inject({ method: "POST", url: "/scrobble/start", payload: { type: "movie", imdbId: "tt1", progress: 500 } });

      expect(txMock.scrobbleSession.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ progress: 100 }) })
      );
    });
  });

  describe("POST /scrobble/pause", () => {
    it("returns 404 when there is no active playing session", async () => {
      prismaMock.scrobbleSession.findFirst.mockResolvedValue(null);
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/scrobble/pause", payload: { imdbId: "tt1" } });
      expect(response.statusCode).toBe(404);
    });

    it("pauses an active session and pushes a pause event to Trakt", async () => {
      prismaMock.scrobbleSession.findFirst.mockResolvedValue({ id: "s1", type: "movie", seriesImdbId: null });
      prismaMock.scrobbleSession.update.mockResolvedValue({ id: "s1", status: "paused", progress: 42 });

      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/scrobble/pause",
        payload: { imdbId: "tt1", progress: 42 },
      });

      expect(response.statusCode).toBe(200);
      expect(traktClientMock.pushTraktScrobble).toHaveBeenCalledWith(
        "pause",
        expect.objectContaining({ progress: 42 }),
        expect.anything()
      );
    });
  });

  describe("POST /scrobble/stop — completion threshold", () => {
    it("returns 404 when no active session is found", async () => {
      prismaMock.scrobbleSession.findFirst.mockResolvedValue(null);
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/scrobble/stop", payload: { imdbId: "tt1" } });
      expect(response.statusCode).toBe(404);
    });

    it("records a watch event when progress meets the 80% completion threshold", async () => {
      prismaMock.scrobbleSession.findFirst.mockResolvedValue({
        id: "s1",
        type: "movie",
        season: null,
        episode: null,
        seriesImdbId: null,
        progress: 50,
      });
      prismaMock.scrobbleSession.update.mockResolvedValue({ id: "s1", status: "stopped", progress: 80 });

      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/scrobble/stop",
        payload: { imdbId: "tt1", progress: 80 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().recorded).toBe(true);
      expect(watchEventMock.recordWatchEvent).toHaveBeenCalled();
      expect(traktClientMock.pushTraktScrobble).not.toHaveBeenCalled();
    });

    it("does not record a watch event when progress is just below the 80% threshold", async () => {
      prismaMock.scrobbleSession.findFirst.mockResolvedValue({
        id: "s1",
        type: "movie",
        season: null,
        episode: null,
        seriesImdbId: null,
        progress: 50,
      });
      prismaMock.scrobbleSession.update.mockResolvedValue({ id: "s1", status: "stopped", progress: 79 });

      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/scrobble/stop",
        payload: { imdbId: "tt1", progress: 79 },
      });

      expect(response.json().recorded).toBe(false);
      expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
      expect(traktClientMock.pushTraktScrobble).toHaveBeenCalledWith(
        "stop",
        expect.objectContaining({ progress: 79 }),
        expect.anything()
      );
    });

    it("falls back to the session's stored progress when no progress is supplied", async () => {
      prismaMock.scrobbleSession.findFirst.mockResolvedValue({
        id: "s1",
        type: "movie",
        season: null,
        episode: null,
        seriesImdbId: null,
        progress: 95,
      });
      prismaMock.scrobbleSession.update.mockResolvedValue({ id: "s1", status: "stopped", progress: 95 });

      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/scrobble/stop", payload: { imdbId: "tt1" } });

      expect(response.json().recorded).toBe(true);
    });
  });

  describe("GET /scrobble/now-playing", () => {
    it("returns an empty list when there are no active sessions", async () => {
      prismaMock.scrobbleSession.findMany.mockResolvedValue([]);
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/scrobble/now-playing" });
      expect(response.json()).toEqual({ sessions: [] });
    });

    it("attaches metadata name/poster to active sessions", async () => {
      prismaMock.scrobbleSession.findMany.mockResolvedValue([
        { id: "s1", imdbId: "tt1", type: "movie", seriesImdbId: null, status: "playing" },
      ]);
      prismaMock.metadata.findMany.mockResolvedValue([{ imdbId: "tt1", name: "Movie A", poster: "poster.jpg" }]);

      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/scrobble/now-playing" });

      expect(response.json().sessions[0]).toEqual(
        expect.objectContaining({ name: "Movie A", poster: "poster.jpg" })
      );
    });
  });

  describe("POST /checkin — validation", () => {
    const checkIn = (app: FastifyInstance, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/checkin", payload });

    const storedCheckIn = (over: Record<string, unknown> = {}) => ({
      type: "movie",
      imdbId: "tt1",
      seriesImdbId: null,
      season: null,
      episode: null,
      name: "Movie A",
      poster: null,
      startedAt: new Date("2026-08-06T12:00:00Z"),
      expiresAt: null,
      ...over,
    });

    it("stores a valid check-in", async () => {
      prismaMock.checkIn.upsert.mockResolvedValue(storedCheckIn());
      prismaMock.metadata.findUnique.mockResolvedValue(null);

      const app = await buildApp();
      const response = await checkIn(app, { type: "movie", imdbId: "tt1", name: "Movie A", runtime: 120 });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.checkIn.upsert).toHaveBeenCalled();
    });

    it("rejects a non-string name before it reaches the database", async () => {
      const app = await buildApp();
      const response = await checkIn(app, { type: "movie", imdbId: "tt1", name: 42 });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("name must be a string");
      expect(prismaMock.checkIn.upsert).not.toHaveBeenCalled();
    });

    it("names the field that is missing", async () => {
      const app = await buildApp();
      const response = await checkIn(app, { type: "movie", name: "Movie A" });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("imdbId is required");
    });

    it("rejects an unknown type the way its neighbours do", async () => {
      const app = await buildApp();
      const response = await checkIn(app, { type: "bogus", imdbId: "tt1", name: "Movie A" });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("type must be one of: movie, episode");
    });

    it("refuses a name large enough to park a multi-megabyte row", async () => {
      const app = await buildApp();
      const response = await checkIn(app, { type: "movie", imdbId: "tt1", name: "x".repeat(5_000) });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("name must be at most 300 characters");
    });

    it.each(["imdbId", "name", "seriesImdbId"])("refuses a whitespace-only %s", async (field) => {
      const app = await buildApp();
      const response = await checkIn(app, {
        type: "movie",
        imdbId: "tt1",
        name: "Movie A",
        [field]: "   ",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe(`${field} must not be empty`);
      expect(prismaMock.checkIn.upsert).not.toHaveBeenCalled();
    });

    it("refuses a runtime of zero, which would expire the check-in as it was made", async () => {
      const app = await buildApp();
      const response = await checkIn(app, { type: "movie", imdbId: "tt1", name: "Movie A", runtime: 0 });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("runtime must be at least 1");
      expect(prismaMock.checkIn.upsert).not.toHaveBeenCalled();
    });

    it("refuses a runtime that would make expiresAt an Invalid Date", async () => {
      const app = await buildApp();
      const response = await checkIn(app, {
        type: "movie",
        imdbId: "tt1",
        name: "Movie A",
        runtime: Number.MAX_SAFE_INTEGER,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("runtime must be at most 1440");
      expect(prismaMock.checkIn.upsert).not.toHaveBeenCalled();
    });

    it("accepts the nulls the web client sends for absent optional fields", async () => {
      prismaMock.checkIn.upsert.mockResolvedValue(storedCheckIn());
      prismaMock.metadata.findUnique.mockResolvedValue(null);

      const app = await buildApp();
      const response = await checkIn(app, {
        type: "movie",
        imdbId: "tt1",
        name: "Movie A",
        poster: null,
        runtime: null,
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
