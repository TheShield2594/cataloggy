import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_PROFILE_ID = "99999999-9999-4999-8999-999999999999";

class StremioApiError extends Error {}

const connectStremio = vi.fn();
const disconnectStremio = vi.fn();
const getStremioStatus = vi.fn();
const isStremioConnected = vi.fn();
const resetStremioClient = vi.fn();
const syncStremioLibrary = vi.fn();
const getPendingPlaySignals = vi.fn();
const isPlayDetectionEnabled = vi.fn();
const recordPlaySignal = vi.fn();

vi.mock("../lib/stremio-library.js", () => ({
  StremioApiError,
  connectStremio: (...a: unknown[]) => connectStremio(...a),
  disconnectStremio: (...a: unknown[]) => disconnectStremio(...a),
  getStremioStatus: () => getStremioStatus(),
  isStremioConnected: () => isStremioConnected(),
  resetStremioClient: () => resetStremioClient(),
  syncStremioLibrary: (...a: unknown[]) => syncStremioLibrary(...a),
}));
vi.mock("../lib/play-signal.js", () => ({
  getPendingPlaySignals: (...a: unknown[]) => getPendingPlaySignals(...a),
  isPlayDetectionEnabled: () => isPlayDetectionEnabled(),
  recordPlaySignal: (...a: unknown[]) => recordPlaySignal(...a),
}));
vi.mock("../lib/profile.js", () => ({
  getDefaultProfileId: async () => DEFAULT_PROFILE_ID,
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: stremioLibraryRoutes } = await import("./stremio-library.js");
  const app = Fastify({ logger: false });
  await app.register(stremioLibraryRoutes);
  await app.ready();
  return app;
};

const playSignal = (over: Record<string, unknown> = {}) => ({
  type: "movie",
  imdbId: "tt1",
  resource: "stream",
  ...over,
});

describe("Stremio library routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStremioStatus.mockResolvedValue({ connected: true, email: "a@example.com" });
    isStremioConnected.mockResolvedValue(true);
    syncStremioLibrary.mockResolvedValue({ imported: 3 });
    connectStremio.mockResolvedValue(undefined);
    disconnectStremio.mockResolvedValue(undefined);
    isPlayDetectionEnabled.mockReturnValue(true);
    recordPlaySignal.mockResolvedValue({ status: "pending" });
    getPendingPlaySignals.mockResolvedValue([]);
  });

  describe("POST /stremio/library/connect", () => {
    it("connects and takes a baseline without recording history", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/stremio/library/connect",
        payload: { email: " a@example.com ", password: "pw" },
      });

      expect(res.statusCode).toBe(200);
      expect(connectStremio).toHaveBeenCalledWith("a@example.com", "pw", PROFILE_ID, expect.anything());
      expect(syncStremioLibrary).toHaveBeenCalledWith(expect.anything(), PROFILE_ID, "baseline");
      await app.close();
    });

    it("returns 401 with Stremio's own message on bad credentials", async () => {
      connectStremio.mockRejectedValue(new StremioApiError("Wrong password"));
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/stremio/library/connect",
        payload: { email: "a@example.com", password: "wrong" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Wrong password");
      await app.close();
    });

    it("returns 502 when Stremio cannot be reached", async () => {
      connectStremio.mockRejectedValue(new Error("ECONNREFUSED"));
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/stremio/library/connect",
        payload: { email: "a@example.com", password: "pw" },
      });

      expect(res.statusCode).toBe(502);
      await app.close();
    });

    it("undoes the connection when the baseline sync fails", async () => {
      // A connection with no baseline would make the next incremental pass
      // treat the whole library as newly watched.
      syncStremioLibrary.mockRejectedValue(new Error("library read failed"));
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/stremio/library/connect",
        payload: { email: "a@example.com", password: "pw" },
      });

      expect(res.statusCode).toBe(502);
      expect(disconnectStremio).toHaveBeenCalled();
      expect(resetStremioClient).toHaveBeenCalled();
      expect(res.json().error).toMatch(/Nothing was saved/);
      await app.close();
    });

    it("requires both an email and a password", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/stremio/library/connect",
        payload: { email: "a@example.com" },
      });

      expect(res.statusCode).toBe(400);
      expect(connectStremio).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe("POST /stremio/library/import and /sync", () => {
    it("imports into the calling profile", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/stremio/library/import" });

      expect(res.statusCode).toBe(200);
      expect(syncStremioLibrary).toHaveBeenCalledWith(expect.anything(), PROFILE_ID, "import");
      await app.close();
    });

    it("runs the incremental pass on demand", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/stremio/library/sync" });

      expect(res.statusCode).toBe(200);
      expect(syncStremioLibrary).toHaveBeenCalledWith(expect.anything(), PROFILE_ID, "incremental");
      await app.close();
    });

    it("400s when no account is connected", async () => {
      isStremioConnected.mockResolvedValue(false);
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/stremio/library/import" });

      expect(res.statusCode).toBe(400);
      expect(syncStremioLibrary).not.toHaveBeenCalled();
      await app.close();
    });

    it("502s when the import throws", async () => {
      syncStremioLibrary.mockRejectedValue(new Error("upstream"));
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/stremio/library/import" });

      expect(res.statusCode).toBe(502);
      await app.close();
    });
  });

  describe("POST /stremio/library/disconnect", () => {
    it("clears the stored account and the cached client", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/stremio/library/disconnect" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ connected: false });
      expect(resetStremioClient).toHaveBeenCalled();
      await app.close();
    });
  });

  describe("POST /stremio/play-signal", () => {
    it("records a signal for the profile the addon reports", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/stremio/play-signal",
        payload: playSignal({ profileId: PROFILE_ID }),
      });

      expect(res.statusCode).toBe(202);
      expect(recordPlaySignal).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: PROFILE_ID, imdbId: "tt1", resource: "stream" })
      );
      await app.close();
    });

    it("falls back to the default profile when the reported one is not a UUID", async () => {
      // The body is addon-supplied, so the id is validated rather than trusted.
      const app = await buildApp();

      await app.inject({
        method: "POST",
        url: "/stremio/play-signal",
        payload: playSignal({ profileId: "../../etc/passwd" }),
      });

      expect(recordPlaySignal).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: DEFAULT_PROFILE_ID })
      );
      await app.close();
    });

    it("accepts but ignores signals when play detection is off", async () => {
      isPlayDetectionEnabled.mockReturnValue(false);
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/stremio/play-signal", payload: playSignal() });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: "disabled" });
      expect(recordPlaySignal).not.toHaveBeenCalled();
      await app.close();
    });

    it("truncates an over-long client identifier", async () => {
      const app = await buildApp();

      await app.inject({
        method: "POST",
        url: "/stremio/play-signal",
        payload: playSignal({ client: "x".repeat(500) }),
      });

      expect(recordPlaySignal.mock.calls[0][0].client).toHaveLength(200);
      await app.close();
    });

    it("falls back to the request user-agent when no client is sent", async () => {
      const app = await buildApp();

      await app.inject({
        method: "POST",
        url: "/stremio/play-signal",
        headers: { "user-agent": "Stremio/5.0" },
        payload: playSignal(),
      });

      expect(recordPlaySignal.mock.calls[0][0].client).toBe("Stremio/5.0");
      await app.close();
    });

    it("rejects an unknown resource", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/stremio/play-signal",
        payload: playSignal({ resource: "meta" }),
      });

      expect(res.statusCode).toBe(400);
      expect(recordPlaySignal).not.toHaveBeenCalled();
      await app.close();
    });

    it("rejects an unknown watch type", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/stremio/play-signal",
        payload: playSignal({ type: "season" }),
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("rejects a missing imdbId", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/stremio/play-signal",
        payload: { type: "movie", resource: "stream" },
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("GET /stremio/play-signals", () => {
    it("reports the calling profile's pending signals", async () => {
      getPendingPlaySignals.mockResolvedValue([{ imdbId: "tt1" }]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/stremio/play-signals" });

      expect(res.statusCode).toBe(200);
      expect(getPendingPlaySignals).toHaveBeenCalledWith(PROFILE_ID);
      expect(res.json()).toMatchObject({ enabled: true, signals: [{ imdbId: "tt1" }] });
      await app.close();
    });
  });
});
