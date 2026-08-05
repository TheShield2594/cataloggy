import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const getPlayerSummary = vi.fn();
const getSteam = vi.fn();
const isSteamSyncConfigured = vi.fn();
const syncSteamLibrary = vi.fn();

vi.mock("../lib/steam-client.js", () => ({ getSteam: () => getSteam() }));
vi.mock("../lib/steam-sync.js", () => ({
  isSteamSyncConfigured: () => isSteamSyncConfigured(),
  syncSteamLibrary: (...a: unknown[]) => syncSteamLibrary(...a),
}));
vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: gamesSteamRoutes } = await import("./games-steam.js");
  const app = Fastify({ logger: false });
  await app.register(gamesSteamRoutes);
  await app.ready();
  return app;
};

describe("Steam games routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STEAM_ID = "76561198000000000";
    getSteam.mockReturnValue({ getPlayerSummary });
    getPlayerSummary.mockResolvedValue({ personaname: "player", avatar: null });
    isSteamSyncConfigured.mockReturnValue(true);
    syncSteamLibrary.mockResolvedValue({ added: 2, updated: 1 });
  });

  afterEach(() => {
    delete process.env.STEAM_ID;
  });

  describe("GET /games/steam/status", () => {
    it("reports the connected player when Steam is configured", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games/steam/status" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ configured: true, player: { personaname: "player" } });
      await app.close();
    });

    it("reports unconfigured without calling Steam", async () => {
      isSteamSyncConfigured.mockReturnValue(false);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games/steam/status" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ configured: false, player: null });
      expect(getSteam).not.toHaveBeenCalled();
      await app.close();
    });

    it("still reports configured when the player lookup fails", async () => {
      // The summary is a display nicety; sync does not depend on it, so a
      // failing lookup must not read as "Steam is not set up".
      getPlayerSummary.mockRejectedValue(new Error("Steam API 503"));
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games/steam/status" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ configured: true, player: null });
      await app.close();
    });
  });

  describe("POST /games/steam/sync", () => {
    it("syncs into the calling profile and returns the summary", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/games/steam/sync" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ added: 2, updated: 1 });
      expect(syncSteamLibrary).toHaveBeenCalledWith(expect.anything(), PROFILE_ID);
      await app.close();
    });

    it("returns 500 when Steam is not configured", async () => {
      isSteamSyncConfigured.mockReturnValue(false);
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/games/steam/sync" });

      expect(res.statusCode).toBe(500);
      expect(syncSteamLibrary).not.toHaveBeenCalled();
      await app.close();
    });

    it("returns 500 when the sync throws", async () => {
      syncSteamLibrary.mockRejectedValue(new Error("boom"));
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/games/steam/sync" });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toMatch(/sync failed/i);
      await app.close();
    });
  });
});
