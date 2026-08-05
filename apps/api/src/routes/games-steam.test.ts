import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

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

const buildApp = (): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./games-steam.js"));

describe("Steam games routes", () => {
  // The route reads STEAM_ID straight off the environment, so these tests set
  // it. Restoring whatever was there before matters: a developer with a real
  // STEAM_ID exported would otherwise have it deleted for every test file that
  // runs after this one in the same worker.
  let originalSteamId: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalSteamId = process.env.STEAM_ID;
    process.env.STEAM_ID = "76561198000000000";
    getSteam.mockReturnValue({ getPlayerSummary });
    getPlayerSummary.mockResolvedValue({ personaname: "player", avatar: null });
    isSteamSyncConfigured.mockReturnValue(true);
    syncSteamLibrary.mockResolvedValue({ added: 2, updated: 1 });
  });

  afterEach(() => {
    if (originalSteamId === undefined) delete process.env.STEAM_ID;
    else process.env.STEAM_ID = originalSteamId;
  });

  describe("GET /games/steam/status", () => {
    it("reports the connected player when Steam is configured", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games/steam/status" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ configured: true, player: { personaname: "player" } });
    });

    it("reports unconfigured without calling Steam", async () => {
      isSteamSyncConfigured.mockReturnValue(false);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games/steam/status" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ configured: false, player: null });
      expect(getSteam).not.toHaveBeenCalled();
    });

    it("still reports configured when the player lookup fails", async () => {
      // The summary is a display nicety; sync does not depend on it, so a
      // failing lookup must not read as "Steam is not set up".
      getPlayerSummary.mockRejectedValue(new Error("Steam API 503"));
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/games/steam/status" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ configured: true, player: null });
    });
  });

  describe("POST /games/steam/sync", () => {
    it("syncs into the calling profile and returns the summary", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/games/steam/sync" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ added: 2, updated: 1 });
      expect(syncSteamLibrary).toHaveBeenCalledWith(expect.anything(), PROFILE_ID);
    });

    it("returns 500 when Steam is not configured", async () => {
      isSteamSyncConfigured.mockReturnValue(false);
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/games/steam/sync" });

      expect(res.statusCode).toBe(500);
      expect(syncSteamLibrary).not.toHaveBeenCalled();
    });

    it("returns 500 when the sync throws", async () => {
      syncSteamLibrary.mockRejectedValue(new Error("boom"));
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/games/steam/sync" });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toMatch(/sync failed/i);
    });
  });
});
