import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { Prisma } from "@prisma/client";

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

const p2002 = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0" });

// vi.clearAllMocks() (used below) does not drain queued mockResolvedValueOnce
// values or reset persistent implementations, so a fully explicit reset here
// (plus re-arming the two factory mocks) keeps each test's call sequencing
// isolated from whatever the previous test queued.
const resetMocks = () => {
  vi.resetModules();
  vi.resetAllMocks();
  getSteamMock.mockImplementation(() => steamClientMock);
  getIgdbMock.mockImplementation(() => igdbClientMock);
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

    it("refreshes playtime/lastPlayed on an already-linked row without touching cover, igdbId, or personal fields", async () => {
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
      prismaMock.game.findFirst.mockResolvedValueOnce({
        id: "game-1",
        igdbId: 1942,
        coverUrl: "https://images.igdb.com/existing.jpg",
        lastPlayedAt: new Date("2026-07-01T00:00:00Z")
      });

      const { syncSteamLibrary } = await import("./steam-sync.js");
      const summary = await syncSteamLibrary(makeLogger(), "profile-1");

      expect(prismaMock.game.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.game.update).toHaveBeenCalledWith({
        where: { id: "game-1" },
        data: {
          playtimeMinutes: 800,
          lastPlayedAt: new Date("2026-07-10T00:00:00Z"),
          coverUrl: "https://images.igdb.com/existing.jpg"
        }
      });
      expect(prismaMock.game.create).not.toHaveBeenCalled();
      expect(igdbClientMock.findBestMatch).not.toHaveBeenCalled();
      expect(summary).toEqual({ total: 1, created: 0, updated: 1, matched: 0, unmatched: 0 });
    });

    it("enriches an existing Steam-only row with IGDB metadata once a match becomes available", async () => {
      steamClientMock.getOwnedGames.mockResolvedValue([
        {
          appId: 620,
          name: "Portal 2",
          playtimeForeverMinutes: 800,
          playtime2WeeksMinutes: 60,
          lastPlayedAt: new Date("2026-07-10T00:00:00Z"),
          iconUrl: null
        }
      ]);
      prismaMock.game.findFirst.mockResolvedValueOnce({
        id: "game-1",
        igdbId: null,
        coverUrl: null,
        lastPlayedAt: null
      });
      igdbClientMock.findBestMatch.mockResolvedValue({
        igdbId: 1942,
        title: "Portal 2",
        coverUrl: "https://images.igdb.com/portal2.jpg",
        releaseDate: "2011-04-18",
        genres: ["Puzzle"]
      });

      const { syncSteamLibrary } = await import("./steam-sync.js");
      const summary = await syncSteamLibrary(makeLogger(), "profile-1");

      expect(prismaMock.game.update).toHaveBeenCalledTimes(2);
      expect(prismaMock.game.update).toHaveBeenNthCalledWith(1, {
        where: { id: "game-1" },
        data: { playtimeMinutes: 800, lastPlayedAt: new Date("2026-07-10T00:00:00Z"), coverUrl: undefined }
      });
      expect(prismaMock.game.update).toHaveBeenNthCalledWith(2, {
        where: { id: "game-1" },
        data: {
          igdbId: 1942,
          coverUrl: "https://images.igdb.com/portal2.jpg",
          releaseDate: new Date("2011-04-18"),
          genres: ["Puzzle"]
        }
      });
      expect(summary).toEqual({ total: 1, created: 0, updated: 1, matched: 1, unmatched: 0 });
    });

    it("leaves an existing Steam-only row unmatched again when IGDB still finds nothing", async () => {
      steamClientMock.getOwnedGames.mockResolvedValue([
        {
          appId: 620,
          name: "Some Obscure Game",
          playtimeForeverMinutes: 5,
          playtime2WeeksMinutes: 0,
          lastPlayedAt: null,
          iconUrl: null
        }
      ]);
      prismaMock.game.findFirst.mockResolvedValueOnce({ id: "game-1", igdbId: null, coverUrl: null, lastPlayedAt: null });
      igdbClientMock.findBestMatch.mockResolvedValue(null);

      const { syncSteamLibrary } = await import("./steam-sync.js");
      const summary = await syncSteamLibrary(makeLogger(), "profile-1");

      expect(prismaMock.game.update).toHaveBeenCalledTimes(1);
      expect(summary).toEqual({ total: 1, created: 0, updated: 1, matched: 0, unmatched: 1 });
    });

    it("creates a new row from Steam data, already carrying an IGDB match when found", async () => {
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
      // Call 1: no existing row for this steamAppId. Call 2: no existing row for the matched igdbId either.
      prismaMock.game.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
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
          igdbId: 1942,
          title: "Portal 2",
          coverUrl: "https://images.igdb.com/portal2.jpg",
          releaseDate: new Date("2011-04-18"),
          genres: ["Puzzle", "Platform"],
          playtimeMinutes: 100,
          lastPlayedAt: null
        }
      });
      expect(prismaMock.game.update).not.toHaveBeenCalled();
      expect(summary).toEqual({ total: 1, created: 1, updated: 0, matched: 1, unmatched: 0 });
    });

    it("links a Steam game to a pre-existing (e.g. manually added) row instead of creating a duplicate", async () => {
      steamClientMock.getOwnedGames.mockResolvedValue([
        {
          appId: 620,
          name: "Portal 2",
          playtimeForeverMinutes: 100,
          playtime2WeeksMinutes: 0,
          lastPlayedAt: new Date("2026-07-10T00:00:00Z"),
          iconUrl: "https://example.com/icon.jpg"
        }
      ]);
      // Call 1: no row linked to this steamAppId yet. Call 2: a manually-added row already
      // exists for the matched igdbId.
      prismaMock.game.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "manual-1", coverUrl: "https://images.igdb.com/manual.jpg", lastPlayedAt: null });
      igdbClientMock.findBestMatch.mockResolvedValue({
        igdbId: 1942,
        title: "Portal 2",
        coverUrl: "https://images.igdb.com/portal2.jpg",
        releaseDate: "2011-04-18",
        genres: ["Puzzle"]
      });

      const { syncSteamLibrary } = await import("./steam-sync.js");
      const summary = await syncSteamLibrary(makeLogger(), "profile-1");

      expect(prismaMock.game.create).not.toHaveBeenCalled();
      expect(prismaMock.game.update).toHaveBeenCalledWith({
        where: { id: "manual-1" },
        data: {
          steamAppId: 620,
          playtimeMinutes: 100,
          lastPlayedAt: new Date("2026-07-10T00:00:00Z"),
          coverUrl: "https://images.igdb.com/manual.jpg"
        }
      });
      expect(summary).toEqual({ total: 1, created: 0, updated: 1, matched: 1, unmatched: 0 });
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
      prismaMock.game.findFirst.mockResolvedValueOnce(null);
      igdbClientMock.findBestMatch.mockResolvedValue(null);

      const { syncSteamLibrary } = await import("./steam-sync.js");
      const summary = await syncSteamLibrary(makeLogger(), "profile-1");

      expect(prismaMock.game.create).toHaveBeenCalledWith({
        data: {
          profileId: "profile-1",
          steamAppId: 12345,
          igdbId: undefined,
          title: "Some Obscure Game",
          coverUrl: null,
          releaseDate: null,
          genres: [],
          playtimeMinutes: 5,
          lastPlayedAt: null
        }
      });
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
      prismaMock.game.findFirst.mockResolvedValueOnce(null);
      getIgdbMock.mockImplementationOnce(() => {
        throw new Error("Twitch credentials are incomplete. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.");
      });

      const { syncSteamLibrary } = await import("./steam-sync.js");
      const logger = makeLogger();
      const summary = await syncSteamLibrary(logger, "profile-1");

      expect(summary).toEqual({ total: 1, created: 1, updated: 0, matched: 0, unmatched: 1 });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("recovers from a concurrent-sync unique-constraint race on create instead of failing", async () => {
      steamClientMock.getOwnedGames.mockResolvedValue([
        {
          appId: 620,
          name: "Portal 2",
          playtimeForeverMinutes: 100,
          playtime2WeeksMinutes: 0,
          lastPlayedAt: new Date("2026-07-10T00:00:00Z"),
          iconUrl: "https://example.com/icon.jpg"
        }
      ]);
      // Call 1 (pre-create check): nothing yet. Call 2 (post-P2002 recovery): the row a
      // concurrent sync created in the meantime.
      prismaMock.game.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "raced-1", coverUrl: null, lastPlayedAt: null });
      igdbClientMock.findBestMatch.mockResolvedValue(null);
      prismaMock.game.create.mockRejectedValue(p2002());

      const { syncSteamLibrary } = await import("./steam-sync.js");
      const summary = await syncSteamLibrary(makeLogger(), "profile-1");

      expect(prismaMock.game.update).toHaveBeenCalledWith({
        where: { id: "raced-1" },
        data: {
          steamAppId: 620,
          playtimeMinutes: 100,
          lastPlayedAt: new Date("2026-07-10T00:00:00Z"),
          coverUrl: "https://example.com/icon.jpg"
        }
      });
      expect(summary).toEqual({ total: 1, created: 0, updated: 1, matched: 0, unmatched: 0 });
    });

    it("rethrows a create failure that isn't a recoverable unique-constraint race", async () => {
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
      prismaMock.game.findFirst.mockResolvedValueOnce(null);
      igdbClientMock.findBestMatch.mockResolvedValue(null);
      prismaMock.game.create.mockRejectedValue(new Error("connection lost"));

      const { syncSteamLibrary } = await import("./steam-sync.js");
      await expect(syncSteamLibrary(makeLogger(), "profile-1")).rejects.toThrow("connection lost");
    });
  });
});
