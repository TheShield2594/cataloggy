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
    child: vi.fn(),
  }) as unknown as FastifyBaseLogger;

const prismaMock = {
  playSignal: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  metadata: { findUnique: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const watchEventMock = { recordWatchEvent: vi.fn() };
vi.mock("./watch-event.js", () => watchEventMock);

const PROFILE = "profile-1";
const MINUTE = 60 * 1000;

const pending = (over: Record<string, unknown> = {}) => ({
  id: "signal-1",
  key: "episode:tt0903747:2:6",
  type: "episode",
  imdbId: "tt0903747",
  season: 2,
  episode: 6,
  resource: "subtitles",
  client: null,
  firstSeenAt: new Date(Date.now() - 60 * MINUTE),
  lastSeenAt: new Date(Date.now() - 30 * MINUTE),
  dueAt: new Date(Date.now() + 60 * MINUTE),
  profileId: PROFILE,
  ...over,
});

const episodeSignal = (season: number, episode: number) => ({
  type: "episode" as const,
  imdbId: "tt0903747",
  seriesImdbId: "tt0903747",
  season,
  episode,
  resource: "subtitles" as const,
  profileId: PROFILE,
  log: makeLogger(),
});

describe("play-signal", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STREMIO_PLAY_DETECTION = "true";
    prismaMock.playSignal.findUnique.mockResolvedValue(null);
    prismaMock.playSignal.findMany.mockResolvedValue([]);
    prismaMock.playSignal.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.metadata.findUnique.mockResolvedValue({ runtime: 50 });
    watchEventMock.recordWatchEvent.mockResolvedValue({ status: "recorded" });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("does nothing at all when play detection is disabled", async () => {
    delete process.env.STREMIO_PLAY_DETECTION;
    const { recordPlaySignal } = await import("./play-signal.js");

    const result = await recordPlaySignal(episodeSignal(2, 7));

    expect(result.status).toBe("disabled");
    expect(prismaMock.playSignal.create).not.toHaveBeenCalled();
  });

  it("opens a pending signal due at 80% of the title's runtime", async () => {
    const { recordPlaySignal } = await import("./play-signal.js");

    const before = Date.now();
    const result = await recordPlaySignal(episodeSignal(2, 7));

    expect(result.status).toBe("opened");
    const created = prismaMock.playSignal.create.mock.calls[0][0].data;
    expect(created.key).toBe("episode:tt0903747:2:7");
    // 50 minutes of runtime × 0.8 = 40 minutes out.
    expect(created.dueAt.getTime() - before).toBeGreaterThanOrEqual(40 * MINUTE - 1000);
    expect(created.dueAt.getTime() - before).toBeLessThanOrEqual(40 * MINUTE + 5000);
  });

  it("records no watch when a signal merely opens", async () => {
    const { recordPlaySignal } = await import("./play-signal.js");

    await recordPlaySignal(episodeSignal(2, 7));

    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("refreshes rather than duplicating a repeat request for the same title", async () => {
    prismaMock.playSignal.findUnique.mockResolvedValue(pending({ key: "episode:tt0903747:2:7", episode: 7 }));
    const { recordPlaySignal } = await import("./play-signal.js");

    const result = await recordPlaySignal(episodeSignal(2, 7));

    expect(result.status).toBe("refreshed");
    expect(prismaMock.playSignal.create).not.toHaveBeenCalled();
    expect(prismaMock.playSignal.update).toHaveBeenCalled();
  });

  it("discards a signal that a different title supersedes within the browse window", async () => {
    prismaMock.playSignal.findMany.mockResolvedValue([
      pending({ id: "browsed", firstSeenAt: new Date(Date.now() - 30 * 1000) }),
    ]);
    const { recordPlaySignal } = await import("./play-signal.js");

    await recordPlaySignal({ ...episodeSignal(0, 0), type: "movie", imdbId: "tt0111161", seriesImdbId: null });

    expect(prismaMock.playSignal.deleteMany).toHaveBeenCalledWith({ where: { id: "browsed" } });
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("settles the previous episode immediately when the next one starts", async () => {
    prismaMock.playSignal.findMany.mockResolvedValue([pending()]);
    const { recordPlaySignal } = await import("./play-signal.js");

    await recordPlaySignal(episodeSignal(2, 7));

    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "episode",
        imdbId: "tt0903747",
        season: 2,
        episode: 6,
        source: "Stremio addon",
      })
    );
    expect(prismaMock.playSignal.deleteMany).toHaveBeenCalledWith({ where: { id: "signal-1" } });
  });

  it("does not settle a pending episode when an earlier one is started", async () => {
    prismaMock.playSignal.findMany.mockResolvedValue([pending({ season: 2, episode: 9 })]);
    const { recordPlaySignal } = await import("./play-signal.js");

    await recordPlaySignal(episodeSignal(2, 7));

    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("does not settle a pending episode from a different series", async () => {
    prismaMock.playSignal.findMany.mockResolvedValue([pending({ imdbId: "tt9999999" })]);
    const { recordPlaySignal } = await import("./play-signal.js");

    await recordPlaySignal(episodeSignal(2, 7));

    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("promotes a signal to a watch once its runtime has elapsed", async () => {
    prismaMock.playSignal.findMany.mockResolvedValue([pending({ dueAt: new Date(Date.now() - MINUTE) })]);
    const { settleDuePlaySignals } = await import("./play-signal.js");

    const result = await settleDuePlaySignals(makeLogger());

    expect(result.settled).toBe(1);
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ imdbId: "tt0903747", season: 2, episode: 6, source: "Stremio addon" })
    );
  });

  it("dates the watch from when the title was last seen, not from when it settled", async () => {
    const lastSeenAt = new Date(Date.now() - 45 * MINUTE);
    prismaMock.playSignal.findMany.mockResolvedValue([
      pending({ dueAt: new Date(Date.now() - MINUTE), lastSeenAt }),
    ]);
    const { settleDuePlaySignals } = await import("./play-signal.js");

    await settleDuePlaySignals(makeLogger());

    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(expect.objectContaining({ watchedAt: lastSeenAt }));
  });

  it("keeps a signal for retry when recording its watch fails", async () => {
    watchEventMock.recordWatchEvent.mockRejectedValue(new Error("boom"));
    prismaMock.playSignal.findMany.mockResolvedValue([pending({ dueAt: new Date(Date.now() - MINUTE) })]);
    const { settleDuePlaySignals } = await import("./play-signal.js");

    const result = await settleDuePlaySignals(makeLogger());

    expect(result.settled).toBe(0);
    expect(prismaMock.playSignal.deleteMany).not.toHaveBeenCalledWith({ where: { id: "signal-1" } });
  });

  it("falls back to a default runtime when metadata carries none", async () => {
    prismaMock.metadata.findUnique.mockResolvedValue({ runtime: null });
    const { recordPlaySignal } = await import("./play-signal.js");

    const before = Date.now();
    await recordPlaySignal({ ...episodeSignal(0, 0), type: "movie", imdbId: "tt0111161", seriesImdbId: null });

    const created = prismaMock.playSignal.create.mock.calls[0][0].data;
    // 100-minute movie default × 0.8 = 80 minutes.
    expect(created.dueAt.getTime() - before).toBeGreaterThanOrEqual(80 * MINUTE - 1000);
  });
});
