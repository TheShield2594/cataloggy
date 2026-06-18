import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const txMock = {
  scrobbleSession: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
};

const prismaMock = {
  scrobbleSession: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  checkIn: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  metadata: { findMany: vi.fn() },
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

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: scrobbleRoutes } = await import("./scrobble.js");
  const app = Fastify();
  await app.register(scrobbleRoutes);
  await app.ready();
  return app;
};

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
      await app.close();
    });

    it("rejects a missing imdbId", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/scrobble/start", payload: { type: "movie" } });
      expect(response.statusCode).toBe(400);
      await app.close();
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
      await app.close();
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
      await app.close();
    });

    it("does not re-push to Trakt when resuming a session that was already playing", async () => {
      txMock.scrobbleSession.findFirst.mockResolvedValue({ id: "s1", status: "playing" });
      txMock.scrobbleSession.update.mockResolvedValue({ id: "s1", status: "playing", progress: 50 });

      const app = await buildApp();
      await app.inject({ method: "POST", url: "/scrobble/start", payload: { type: "movie", imdbId: "tt1", progress: 50 } });

      expect(traktClientMock.pushTraktScrobble).not.toHaveBeenCalled();
      await app.close();
    });

    it("clamps progress to the 0-100 range", async () => {
      txMock.scrobbleSession.findFirst.mockResolvedValue(null);
      txMock.scrobbleSession.create.mockResolvedValue({ id: "s1", status: "playing", progress: 100 });

      const app = await buildApp();
      await app.inject({ method: "POST", url: "/scrobble/start", payload: { type: "movie", imdbId: "tt1", progress: 500 } });

      expect(txMock.scrobbleSession.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ progress: 100 }) })
      );
      await app.close();
    });
  });

  describe("POST /scrobble/pause", () => {
    it("returns 404 when there is no active playing session", async () => {
      prismaMock.scrobbleSession.findFirst.mockResolvedValue(null);
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/scrobble/pause", payload: { imdbId: "tt1" } });
      expect(response.statusCode).toBe(404);
      await app.close();
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
      await app.close();
    });
  });

  describe("POST /scrobble/stop — completion threshold", () => {
    it("returns 404 when no active session is found", async () => {
      prismaMock.scrobbleSession.findFirst.mockResolvedValue(null);
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/scrobble/stop", payload: { imdbId: "tt1" } });
      expect(response.statusCode).toBe(404);
      await app.close();
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
      await app.close();
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
      await app.close();
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
      await app.close();
    });
  });

  describe("GET /scrobble/now-playing", () => {
    it("returns an empty list when there are no active sessions", async () => {
      prismaMock.scrobbleSession.findMany.mockResolvedValue([]);
      const app = await buildApp();
      const response = await app.inject({ method: "GET", url: "/scrobble/now-playing" });
      expect(response.json()).toEqual({ sessions: [] });
      await app.close();
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
      await app.close();
    });
  });
});
