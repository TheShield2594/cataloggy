import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";

const prismaMock = {
  playbackProgress: { upsert: vi.fn(), deleteMany: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const { clearPlaybackProgress, resolvePlaybackTarget, resolveProgressPercent, savePlaybackProgress } =
  await import("./playback.js");

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

describe("resolvePlaybackTarget", () => {
  it("keys a film on its own id and drops any season/episode", () => {
    expect(resolvePlaybackTarget({ type: "movie", imdbId: "tt1", season: 3, episode: 4 })).toEqual({
      key: "movie:tt1",
      type: "movie",
      imdbId: "tt1",
      season: null,
      episode: null,
    });
  });

  it("keys an episode on the series id when one is given", () => {
    expect(
      resolvePlaybackTarget({ type: "episode", imdbId: "tt-ep", seriesImdbId: "tt-show", season: 1, episode: 2 })
    ).toMatchObject({ key: "episode:tt-show:1:2", imdbId: "tt-show" });
  });

  it("treats the imdbId as the series when no seriesImdbId is given", () => {
    expect(resolvePlaybackTarget({ type: "episode", imdbId: "tt-show", season: 0, episode: 1 })).toMatchObject({
      key: "episode:tt-show:0:1",
    });
  });

  it("has nothing to resume for an episode without numbers", () => {
    expect(resolvePlaybackTarget({ type: "episode", imdbId: "tt-show", season: 1 })).toBeNull();
  });
});

describe("resolveProgressPercent", () => {
  it("clamps an explicit percentage", () => {
    expect(resolveProgressPercent({ progress: 140 })).toBe(100);
    expect(resolveProgressPercent({ progress: -3 })).toBe(0);
  });

  it("works it out from position and duration", () => {
    expect(resolveProgressPercent({ positionSeconds: 30, durationSeconds: 120 })).toBe(25);
  });

  it("is null when there is nothing to go on", () => {
    expect(resolveProgressPercent({})).toBeNull();
    expect(resolveProgressPercent({ positionSeconds: 30, durationSeconds: 0 })).toBeNull();
  });
});

describe("savePlaybackProgress", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not write when there is no position to save", async () => {
    expect(await savePlaybackProgress(PROFILE_ID, { type: "movie", imdbId: "tt1" }, {})).toBeNull();
    expect(prismaMock.playbackProgress.upsert).not.toHaveBeenCalled();
  });
});

describe("clearPlaybackProgress", () => {
  const log = { warn: vi.fn() } as unknown as FastifyBaseLogger;

  beforeEach(() => vi.clearAllMocks());

  it("only clears a resume point saved at or before the watch", async () => {
    prismaMock.playbackProgress.deleteMany.mockResolvedValue({ count: 1 });
    const watchedAt = new Date("2025-01-01T00:00:00Z");

    await clearPlaybackProgress(PROFILE_ID, { type: "episode", imdbId: "tt-show", season: 1, episode: 2 }, watchedAt);

    expect(prismaMock.playbackProgress.deleteMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE_ID, key: "episode:tt-show:1:2", pausedAt: { lte: watchedAt } },
    });
  });

  it("swallows a failure so the watch it follows still records", async () => {
    prismaMock.playbackProgress.deleteMany.mockRejectedValue(new Error("db down"));

    await expect(
      clearPlaybackProgress(PROFILE_ID, { type: "movie", imdbId: "tt1" }, new Date(), log)
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
});
