import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resetMocks = () => {
  vi.resetModules();
  vi.clearAllMocks();
};

describe("steam", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetMocks();
    process.env.STEAM_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("SteamClient.fromEnv", () => {
    it("throws when STEAM_API_KEY is missing", async () => {
      delete process.env.STEAM_API_KEY;
      const { SteamClient } = await import("./steam.js");
      expect(() => SteamClient.fromEnv()).toThrow("STEAM_API_KEY is not configured");
    });

    it("returns a client when STEAM_API_KEY is present", async () => {
      const { SteamClient } = await import("./steam.js");
      expect(() => SteamClient.fromEnv()).not.toThrow();
    });
  });

  describe("getOwnedGames", () => {
    it("maps Steam's response shape, deriving playtime/lastPlayed/icon", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            response: {
              game_count: 1,
              games: [
                {
                  appid: 620,
                  name: "Portal 2",
                  playtime_forever: 754,
                  playtime_2weeks: 30,
                  rtime_last_played: 1700000000,
                  img_icon_url: "abcd1234"
                }
              ]
            }
          }),
          { status: 200 }
        )
      );
      vi.stubGlobal("fetch", fetchMock);

      const { SteamClient } = await import("./steam.js");
      const client = SteamClient.fromEnv();
      const games = await client.getOwnedGames("76561198000000000");

      expect(games).toEqual([
        {
          appId: 620,
          name: "Portal 2",
          playtimeForeverMinutes: 754,
          playtime2WeeksMinutes: 30,
          lastPlayedAt: new Date(1700000000 * 1000),
          iconUrl: "https://media.steampowered.com/steamcommunity/public/images/apps/620/abcd1234.jpg"
        }
      ]);
    });

    it("falls back to a placeholder name and nulls when Steam omits optional fields", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ response: { games: [{ appid: 999 }] } }), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const { SteamClient } = await import("./steam.js");
      const client = SteamClient.fromEnv();
      const games = await client.getOwnedGames("76561198000000000");

      expect(games).toEqual([
        {
          appId: 999,
          name: "Steam App 999",
          playtimeForeverMinutes: 0,
          playtime2WeeksMinutes: 0,
          lastPlayedAt: null,
          iconUrl: null
        }
      ]);
    });

    it("retries on 429 with backoff and eventually succeeds", async () => {
      vi.useFakeTimers();
      let calls = 0;
      const fetchMock = vi.fn(async () => {
        calls += 1;
        if (calls < 3) return new Response("rate limited", { status: 429 });
        return new Response(JSON.stringify({ response: { games: [] } }), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { SteamClient } = await import("./steam.js");
      const client = SteamClient.fromEnv();
      const gamesPromise = client.getOwnedGames("76561198000000000");

      await vi.runAllTimersAsync();
      const games = await gamesPromise;

      expect(games).toEqual([]);
      expect(calls).toBe(3);
    });

    it("throws a descriptive error on a non-retryable failure status", async () => {
      const fetchMock = vi.fn(async () => new Response("forbidden", { status: 403 }));
      vi.stubGlobal("fetch", fetchMock);

      const { SteamClient } = await import("./steam.js");
      const client = SteamClient.fromEnv();

      await expect(client.getOwnedGames("76561198000000000")).rejects.toThrow(
        "Steam GetOwnedGames request failed (403)"
      );
    });
  });

  describe("getPlayerSummary", () => {
    it("returns the first player, defaulting missing fields", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({ response: { players: [{ steamid: "76561198000000000", personaname: "Player" }] } }),
          { status: 200 }
        )
      );
      vi.stubGlobal("fetch", fetchMock);

      const { SteamClient } = await import("./steam.js");
      const client = SteamClient.fromEnv();
      const summary = await client.getPlayerSummary("76561198000000000");

      expect(summary).toEqual({
        steamId: "76561198000000000",
        username: "Player",
        avatar: null,
        profileUrl: null
      });
    });

    it("returns null when Steam reports no players (e.g. unknown SteamID)", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ response: { players: [] } }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const { SteamClient } = await import("./steam.js");
      const client = SteamClient.fromEnv();
      const summary = await client.getPlayerSummary("76561198000000000");

      expect(summary).toBeNull();
    });
  });
});
