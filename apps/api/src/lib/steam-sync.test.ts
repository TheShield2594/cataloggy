import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";

const makeLogger = (): FastifyBaseLogger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    silent: vi.fn(),
    child: vi.fn()
  }) as unknown as FastifyBaseLogger;

const prismaMock = {
  game: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const steamClientMock = { getOwnedGames: vi.fn() };
const getSteamMock = vi.fn(() => steamClientMock);
vi.mock("./steam-client.js", () => ({ getSteam: getSteamMock }));

const igdbClientMock = { findBestMatch: vi.fn() };
const getIgdbMock = vi.fn(() => igdbClientMock);
vi.mock("./igdb-client.js", () => ({ getIgdb: getIgdbMock }));

const resetMocks = () => {
  vi.resetModules();
  vi.clearAllMocks();
};

describe("steam-sync", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetMocks();
    process.env.STEAM_ID = "76561198000000000";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("isSteamSyncConfigured", () => {
    it("is false when either env var is missing", async () => {
      delete process.env.STEAM_API_KEY;
      const { isSteamSyncConfigured } = await import("./steam-sync.js");
      expect(isSteamSyncConfigured()).toBe(false);
    });

    it("is true when both env vars are set", async () => {
      process.env.STEAM_API_KEY = "key";
      const { isSteamSyncConfigured } = await import("./steam-sync.js");
      expect(isSteamSyncConfigured()).toBe(true);
    });
  });

  describe("syncSteamLibrary", () => {
    it("throws when STEAM_ID is not configured", async () => {
      delete process.env.STEAM_ID;
      const { syncSteamLibrary } = await import("./steam-sync.js");
      await expect(syncSteamLibrary(makeLogger(), "profile-1")).rejects.toThrow("STEAM_ID is not configured");
    });

    it("refreshes playtime/lastPlayed on an existing row without touching cover or personal fields", async () => {
      steamClientMock.getOwnedGames.mockResolvedValue([
        {
          appId: 620,
          name: "Portal 2",
          playtimeForeverMinutes: 800,
          playtime2WeeksMinutes: 60,
          lastPlayedAt: new Date("2026-07-10T00:00:00Z"),
          iconUrl: "https://example.com/icon.jpg"
        }
      ]);
      prismaMock.game.findFirst.mockResolvedValue({
        id: "game-1",
        coverUrl: "https://images.igdb.com/existing.jpg",
        lastPlayedAt: new Date("2026-07-01T00:00:00Z")
      });

      const { syncSteamLibrary } = await import("./steam-sync.js");
      const summary = await syncSteamLibrary(makeLogger(), "profile-1");

      expect(prismaMock.game.update).toHaveBeenCalledWith({
        where: { id: "game-1" },
        data: {
          playtimeMinutes: 800,
          lastPlayedAt: new Date("2026-07-10T00:00:00Z"),
          coverUrl: "https://images.igdb.com/existing.jpg"
        }
      });
      expect(prismaMock.game.create).not.toHaveBeenCalled();
      expect(summary).toEqual({ total: 1, created: 0, updated: 1, matched: 0, unmatched: 0 });
    });

    it("creates a new row from Steam data, then fills in IGDB artwork on a confident match", async () => {
      steamClientMock.getOwnedGames.mockResolvedValue([
        {
          appId: 620,
          name: "Portal 2",
          playtimeForeverMinutes: 100,
          playtime2WeeksMinutes: 0,
          lastPlayedAt: null,
          iconUrl: "https://example.com/icon.jpg"
        }
      ]);
      prismaMock.game.findFirst.mockResolvedValue(null);
      prismaMock.game.create.mockResolvedValue({ id: "game-new", coverUrl: "https://example.com/icon.jpg" });
      igdbClientMock.findBestMatch.mockResolvedValue({
        igdbId: 1942,
        title: "Portal 2",
        coverUrl: "https://images.igdb.com/portal2.jpg",
        releaseDate: "2011-04-18",
        genres: ["Puzzle", "Platform"]
      });

      const { syncSteamLibrary } = await import("./steam-sync.js");
      const summary = await syncSteamLibrary(makeLogger(), "profile-1");

      expect(prismaMock.game.create).toHaveBeenCalledWith({
        data: {
          profileId: "profile-1",
          steamAppId: 620,
          title: "Portal 2",
          coverUrl: "https://example.com/icon.jpg",
          playtimeMinutes: 100,
          lastPlayedAt: null
        }
      });
      expect(prismaMock.game.update).toHaveBeenCalledWith({
        where: { id: "game-new" },
        data: {
          igdbId: 1942,
          coverUrl: "https://images.igdb.com/portal2.jpg",
          releaseDate: new Date("2011-04-18"),
          genres: ["Puzzle", "Platform"]
        }
      });
      expect(summary).toEqual({ total: 1, created: 1, updated: 0, matched: 1, unmatched: 0 });
    });

    it("leaves a new row Steam-only when IGDB finds no match", async () => {
      steamClientMock.getOwnedGames.mockResolvedValue([
        {
          appId: 12345,
          name: "Some Obscure Game",
          playtimeForeverMinutes: 5,
          playtime2WeeksMinutes: 0,
          lastPlayedAt: null,
          iconUrl: null
        }
      ]);
      prismaMock.game.findFirst.mockResolvedValue(null);
      prismaMock.game.create.mockResolvedValue({ id: "game-new", coverUrl: null });
      igdbClientMock.findBestMatch.mockResolvedValue(null);

      const { syncSteamLibrary } = await import("./steam-sync.js");
      const summary = await syncSteamLibrary(makeLogger(), "profile-1");

      expect(prismaMock.game.update).not.toHaveBeenCalled();
      expect(summary).toEqual({ total: 1, created: 1, updated: 0, matched: 0, unmatched: 1 });
    });

    it("leaves a new row Steam-only when IGDB is not configured, without failing the sync", async () => {
      steamClientMock.getOwnedGames.mockResolvedValue([
        {
          appId: 620,
          name: "Portal 2",
          playtimeForeverMinutes: 100,
          playtime2WeeksMinutes: 0,
          lastPlayedAt: null,
          iconUrl: null
        }
      ]);
      prismaMock.game.findFirst.mockResolvedValue(null);
      prismaMock.game.create.mockResolvedValue({ id: "game-new", coverUrl: null });
      getIgdbMock.mockImplementationOnce(() => {
        throw new Error("Twitch credentials are incomplete. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.");
      });

      const { syncSteamLibrary } = await import("./steam-sync.js");
      const logger = makeLogger();
      const summary = await syncSteamLibrary(logger, "profile-1");

      expect(summary).toEqual({ total: 1, created: 1, updated: 0, matched: 0, unmatched: 1 });
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
