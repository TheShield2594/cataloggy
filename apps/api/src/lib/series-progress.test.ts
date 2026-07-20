import { beforeEach, describe, expect, it, vi } from "vitest";
import { P2002 } from "./test-fixtures/prisma-errors.js";

const prismaMock = {
  seriesProgress: { updateMany: vi.fn(), create: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

describe("isIncomingSeriesProgressNewer", () => {
  it("prefers the later watched timestamp regardless of season/episode", async () => {
    const { isIncomingSeriesProgressNewer } = await import("./series-progress.js");
    const existing = { lastSeason: 5, lastEpisode: 10, lastWatchedAt: new Date("2026-01-01T00:00:00Z") };
    const incoming = { lastSeason: 1, lastEpisode: 1, lastWatchedAt: new Date("2026-01-02T00:00:00Z") };

    expect(isIncomingSeriesProgressNewer(existing, incoming)).toBe(true);
  });

  it("falls back to season when timestamps tie", async () => {
    const { isIncomingSeriesProgressNewer } = await import("./series-progress.js");
    const at = new Date("2026-01-01T00:00:00Z");
    const existing = { lastSeason: 1, lastEpisode: 10, lastWatchedAt: at };
    const incoming = { lastSeason: 2, lastEpisode: 1, lastWatchedAt: at };

    expect(isIncomingSeriesProgressNewer(existing, incoming)).toBe(true);
  });

  it("falls back to episode when timestamp and season tie", async () => {
    const { isIncomingSeriesProgressNewer } = await import("./series-progress.js");
    const at = new Date("2026-01-01T00:00:00Z");
    const existing = { lastSeason: 1, lastEpisode: 2, lastWatchedAt: at };
    const incoming = { lastSeason: 1, lastEpisode: 5, lastWatchedAt: at };

    expect(isIncomingSeriesProgressNewer(existing, incoming)).toBe(true);
  });

  it("returns false when incoming is strictly older/behind", async () => {
    const { isIncomingSeriesProgressNewer } = await import("./series-progress.js");
    const existing = { lastSeason: 3, lastEpisode: 3, lastWatchedAt: new Date("2026-01-05T00:00:00Z") };
    const incoming = { lastSeason: 3, lastEpisode: 2, lastWatchedAt: new Date("2026-01-01T00:00:00Z") };

    expect(isIncomingSeriesProgressNewer(existing, incoming)).toBe(false);
  });
});

describe("upsertSeriesProgressIfNewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not create a row when the update matched an existing newer-or-equal row", async () => {
    prismaMock.seriesProgress.updateMany.mockResolvedValue({ count: 1 });
    const { upsertSeriesProgressIfNewer } = await import("./series-progress.js");

    await upsertSeriesProgressIfNewer("profile-1", "tt123", {
      lastSeason: 2,
      lastEpisode: 3,
      lastWatchedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(prismaMock.seriesProgress.create).not.toHaveBeenCalled();
  });

  it("creates a row when no existing row was old enough to update (first watch)", async () => {
    prismaMock.seriesProgress.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.seriesProgress.create.mockResolvedValue({});
    const { upsertSeriesProgressIfNewer } = await import("./series-progress.js");

    await upsertSeriesProgressIfNewer("profile-1", "tt123", {
      lastSeason: 1,
      lastEpisode: 1,
      lastWatchedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(prismaMock.seriesProgress.create).toHaveBeenCalledWith({
      data: {
        profileId: "profile-1",
        seriesImdbId: "tt123",
        lastSeason: 1,
        lastEpisode: 1,
        lastWatchedAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
  });

  it("swallows a P2002 race when a concurrent request already created the row", async () => {
    prismaMock.seriesProgress.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.seriesProgress.create.mockRejectedValue(P2002);
    const { upsertSeriesProgressIfNewer } = await import("./series-progress.js");

    await expect(
      upsertSeriesProgressIfNewer("profile-1", "tt123", {
        lastSeason: 1,
        lastEpisode: 1,
        lastWatchedAt: new Date("2026-01-01T00:00:00Z"),
      })
    ).resolves.toBeUndefined();
  });

  it("rethrows non-P2002 errors from create", async () => {
    prismaMock.seriesProgress.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.seriesProgress.create.mockRejectedValue(new Error("connection lost"));
    const { upsertSeriesProgressIfNewer } = await import("./series-progress.js");

    await expect(
      upsertSeriesProgressIfNewer("profile-1", "tt123", {
        lastSeason: 1,
        lastEpisode: 1,
        lastWatchedAt: new Date("2026-01-01T00:00:00Z"),
      })
    ).rejects.toThrow("connection lost");
  });
});
