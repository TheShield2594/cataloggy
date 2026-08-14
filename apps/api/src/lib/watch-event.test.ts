import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";

const txMock = {
  watchEvent: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
};

const prismaMock = {
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => unknown) => callback(txMock)),
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const seriesProgressMock = { upsertSeriesProgressIfNewer: vi.fn() };
vi.mock("./series-progress.js", () => seriesProgressMock);

const aiMock = { shouldRefreshAiRecs: vi.fn().mockResolvedValue(false), getAiRecommendations: vi.fn() };
vi.mock("./ai.js", () => aiMock);

const cacheMock = { trendingCacheDeletePrefix: vi.fn() };
vi.mock("./cache.js", () => cacheMock);

const traktClientMock = { syncWatchEventToTrakt: vi.fn() };
vi.mock("./trakt-client.js", () => traktClientMock);

const makeLog = (): FastifyBaseLogger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  }) as unknown as FastifyBaseLogger;

describe("recordWatchEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => unknown) => callback(txMock));
    aiMock.shouldRefreshAiRecs.mockResolvedValue(false);
  });

  describe("episode dedup", () => {
    it("creates a new watch event when no matching episode exists for that day", async () => {
      txMock.watchEvent.findFirst.mockResolvedValue(null);
      txMock.watchEvent.create.mockResolvedValue({ id: "we-1", plays: 1, traktHistoryId: null });

      const { recordWatchEvent } = await import("./watch-event.js");
      const result = await recordWatchEvent({
        type: "episode",
        imdbId: "tt-series",
        seriesImdbId: "tt-series",
        season: 1,
        episode: 2,
        watchedAt: new Date("2024-01-01T12:00:00Z"),
        source: "test",
        profileId: "profile-1",
        log: makeLog(),
      });

      expect(result.wasCreated).toBe(true);
      expect(txMock.watchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: "episode", season: 1, episode: 2 }),
        })
      );
      expect(txMock.watchEvent.update).not.toHaveBeenCalled();
    });

    it("increments plays instead of creating a duplicate when the same episode was already watched that day", async () => {
      txMock.watchEvent.findFirst.mockResolvedValue({ id: "we-existing", plays: 1 });
      txMock.watchEvent.update.mockResolvedValue({ id: "we-existing", plays: 2, traktHistoryId: null });

      const { recordWatchEvent } = await import("./watch-event.js");
      const result = await recordWatchEvent({
        type: "episode",
        imdbId: "tt-series",
        seriesImdbId: "tt-series",
        season: 1,
        episode: 2,
        watchedAt: new Date("2024-01-01T18:00:00Z"),
        source: "test",
        profileId: "profile-1",
        log: makeLog(),
      });

      expect(result.wasCreated).toBe(false);
      expect(txMock.watchEvent.create).not.toHaveBeenCalled();
      expect(txMock.watchEvent.update).toHaveBeenCalledWith({
        where: { id: "we-existing" },
        data: { plays: { increment: 1 }, watchedAt: expect.any(Date), dateUnknown: false },
      });
    });

    it("falls back to imdbId as the series id when seriesImdbId is not provided", async () => {
      txMock.watchEvent.findFirst.mockResolvedValue(null);
      txMock.watchEvent.create.mockResolvedValue({ id: "we-2", plays: 1, traktHistoryId: null });

      const { recordWatchEvent } = await import("./watch-event.js");
      await recordWatchEvent({
        type: "episode",
        imdbId: "tt-series-only",
        season: 3,
        episode: 4,
        watchedAt: new Date("2024-02-01T00:00:00Z"),
        source: "test",
        profileId: "profile-1",
        log: makeLog(),
      });

      expect(txMock.watchEvent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ seriesImdbId: "tt-series-only" }),
        })
      );
    });

    it("treats different season/episode combos on the same day as distinct events", async () => {
      txMock.watchEvent.findFirst.mockResolvedValue(null);
      txMock.watchEvent.create.mockResolvedValue({ id: "we-3", plays: 1, traktHistoryId: null });

      const { recordWatchEvent } = await import("./watch-event.js");
      await recordWatchEvent({
        type: "episode",
        imdbId: "tt-series",
        seriesImdbId: "tt-series",
        season: 1,
        episode: 5,
        watchedAt: new Date("2024-01-01T12:00:00Z"),
        source: "test",
        profileId: "profile-1",
        log: makeLog(),
      });

      expect(txMock.watchEvent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ season: 1, episode: 5 }) })
      );
    });
  });

  describe("movie dedup", () => {
    it("creates a new watch event for a movie watched for the first time that day", async () => {
      txMock.watchEvent.findFirst.mockResolvedValue(null);
      txMock.watchEvent.create.mockResolvedValue({ id: "we-movie-1", plays: 1, traktHistoryId: null });

      const { recordWatchEvent } = await import("./watch-event.js");
      const result = await recordWatchEvent({
        type: "movie",
        imdbId: "tt-movie",
        watchedAt: new Date("2024-03-01T08:00:00Z"),
        source: "test",
        profileId: "profile-1",
        log: makeLog(),
      });

      expect(result.wasCreated).toBe(true);
      expect(txMock.watchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: "movie", imdbId: "tt-movie" }) })
      );
    });

    it("increments plays for a movie re-watched the same day instead of duplicating", async () => {
      txMock.watchEvent.findFirst.mockResolvedValue({ id: "we-movie-existing", plays: 3 });
      txMock.watchEvent.update.mockResolvedValue({ id: "we-movie-existing", plays: 4, traktHistoryId: null });

      const { recordWatchEvent } = await import("./watch-event.js");
      const result = await recordWatchEvent({
        type: "movie",
        imdbId: "tt-movie",
        watchedAt: new Date("2024-03-01T20:00:00Z"),
        source: "test",
        profileId: "profile-1",
        log: makeLog(),
      });

      expect(result.wasCreated).toBe(false);
      expect(txMock.watchEvent.create).not.toHaveBeenCalled();
      expect(txMock.watchEvent.update).toHaveBeenCalledWith({
        where: { id: "we-movie-existing" },
        data: { plays: { increment: 1 }, watchedAt: expect.any(Date), dateUnknown: false },
      });
    });

    it("scopes the dedup lookup to the request's profileId", async () => {
      txMock.watchEvent.findFirst.mockResolvedValue(null);
      txMock.watchEvent.create.mockResolvedValue({ id: "we-movie-2", plays: 1, traktHistoryId: null });

      const { recordWatchEvent } = await import("./watch-event.js");
      await recordWatchEvent({
        type: "movie",
        imdbId: "tt-movie-2",
        watchedAt: new Date("2024-03-02T00:00:00Z"),
        source: "test",
        profileId: "profile-other",
        log: makeLog(),
      });

      expect(txMock.watchEvent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ profileId: "profile-other" }) })
      );
    });
  });

  // `watchevent_dedup_key` turns the read-then-write below into a race one writer
  // loses out loud instead of both writers winning and leaving two rows behind.
  describe("losing the create race", () => {
    const uniqueViolation = () =>
      Object.assign(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }));

    it("re-runs the transaction and increments the row the winner wrote", async () => {
      txMock.watchEvent.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "we-winner", plays: 1 });
      txMock.watchEvent.create.mockRejectedValueOnce(uniqueViolation());
      txMock.watchEvent.update.mockResolvedValue({ id: "we-winner", plays: 2, traktHistoryId: null });

      const { recordWatchEvent } = await import("./watch-event.js");
      const result = await recordWatchEvent({
        type: "movie",
        imdbId: "tt-raced",
        watchedAt: new Date("2024-05-01T09:00:00Z"),
        source: "test",
        profileId: "profile-1",
        log: makeLog(),
      });

      expect(result.wasCreated).toBe(false);
      expect(result.watchEvent).toMatchObject({ id: "we-winner", plays: 2 });
      expect(txMock.watchEvent.create).toHaveBeenCalledTimes(1);
      expect(txMock.watchEvent.update).toHaveBeenCalledWith({
        where: { id: "we-winner" },
        data: { plays: { increment: 1 }, watchedAt: expect.any(Date), dateUnknown: false },
      });
    });

    it("does the same for episodes", async () => {
      txMock.watchEvent.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "we-ep-winner", plays: 1 });
      txMock.watchEvent.create.mockRejectedValueOnce(uniqueViolation());
      txMock.watchEvent.update.mockResolvedValue({ id: "we-ep-winner", plays: 2, traktHistoryId: null });

      const { recordWatchEvent } = await import("./watch-event.js");
      const result = await recordWatchEvent({
        type: "episode",
        imdbId: "tt-series",
        seriesImdbId: "tt-series",
        season: 2,
        episode: 3,
        watchedAt: new Date("2024-05-01T09:00:00Z"),
        source: "test",
        profileId: "profile-1",
        log: makeLog(),
      });

      expect(result.wasCreated).toBe(false);
      expect(result.watchEvent).toMatchObject({ id: "we-ep-winner" });
    });

    // Retrying once absorbs the race. A second P2002 is a different conflict, and
    // retrying forever would hide it.
    it("gives up if the retry hits the constraint too", async () => {
      txMock.watchEvent.findFirst.mockResolvedValue(null);
      txMock.watchEvent.create.mockRejectedValue(uniqueViolation());

      const { recordWatchEvent } = await import("./watch-event.js");
      await expect(
        recordWatchEvent({
          type: "movie",
          imdbId: "tt-stuck",
          watchedAt: new Date("2024-05-02T09:00:00Z"),
          source: "test",
          profileId: "profile-1",
          log: makeLog(),
        })
      ).rejects.toMatchObject({ code: "P2002" });

      expect(txMock.watchEvent.create).toHaveBeenCalledTimes(2);
    });

    it("does not retry an error that isn't a constraint violation", async () => {
      txMock.watchEvent.findFirst.mockResolvedValue(null);
      txMock.watchEvent.create.mockRejectedValue(new Error("connection reset"));

      const { recordWatchEvent } = await import("./watch-event.js");
      await expect(
        recordWatchEvent({
          type: "movie",
          imdbId: "tt-broken",
          watchedAt: new Date("2024-05-03T09:00:00Z"),
          source: "test",
          profileId: "profile-1",
          log: makeLog(),
        })
      ).rejects.toThrow("connection reset");

      expect(txMock.watchEvent.create).toHaveBeenCalledTimes(1);
    });
  });

  it("triggers a best-effort Trakt sync push after recording", async () => {
    txMock.watchEvent.findFirst.mockResolvedValue(null);
    txMock.watchEvent.create.mockResolvedValue({ id: "we-trakt", plays: 1, traktHistoryId: null });

    const { recordWatchEvent } = await import("./watch-event.js");
    await recordWatchEvent({
      type: "movie",
      imdbId: "tt-trakt",
      watchedAt: new Date("2024-04-01T00:00:00Z"),
      source: "test",
      profileId: "profile-1",
      log: makeLog(),
    });

    expect(traktClientMock.syncWatchEventToTrakt).toHaveBeenCalledWith(
      expect.objectContaining({ id: "we-trakt" }),
      expect.objectContaining({ type: "movie", imdbId: "tt-trakt" }),
      expect.anything()
    );
  });
});
