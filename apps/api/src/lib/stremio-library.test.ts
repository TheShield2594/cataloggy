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
  stremioAuth: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  kV: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const watchEventMock = { recordWatchEvent: vi.fn() };
vi.mock("./watch-event.js", () => watchEventMock);

const PROFILE = "profile-1";

/**
 * The one mtime every fixture draws on. Comparison (from `datastoreMeta`) and
 * storage (from the fetched item) have to agree for the incremental path to
 * skip anything, so the tests must not quietly disagree about it either.
 */
const MTIME = "2026-08-01T10:00:00.000Z";

/** Builds the shape `datastoreGet` returns for a library item. */
const libraryItem = (over: Record<string, unknown> = {}) => ({
  _id: "tt0111161",
  type: "movie",
  _mtime: MTIME,
  state: { flaggedWatched: 1, timesWatched: 1, lastWatched: "2026-08-01T09:00:00.000Z" },
  ...over,
});

/** Stubs the two Stremio endpoints this module calls. */
const stubStremio = (opts: { meta?: unknown[]; items?: unknown[] }) => {
  const fetchMock = vi.fn().mockImplementation(async (url: URL) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.toString().includes("datastoreMeta")
        ? { result: opts.meta ?? [] }
        : { result: opts.items ?? [] },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const lastWatermark = () => {
  const call = prismaMock.kV.upsert.mock.calls.at(-1)?.[0];
  return call ? JSON.parse(call.update.value) : null;
};

describe("stremio-library", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    prismaMock.stremioAuth.findUnique.mockResolvedValue({ id: "default", authKey: "key" });
    prismaMock.kV.findUnique.mockResolvedValue(null);
    watchEventMock.recordWatchEvent.mockResolvedValue({ status: "recorded" });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("records nothing when no account is connected", async () => {
    prismaMock.stremioAuth.findUnique.mockResolvedValue(null);
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(summary).toEqual({ scanned: 0, fetched: 0, recorded: 0, skipped: 0 });
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("records a watched movie with Stremio's own watch date", async () => {
    stubStremio({ meta: [["tt0111161", MTIME]], items: [libraryItem()] });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(summary.recorded).toBe(1);
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "movie",
        imdbId: "tt0111161",
        source: "Stremio",
        profileId: PROFILE,
        watchedAt: new Date("2026-08-01T09:00:00.000Z"),
      })
    );
  });

  it("records the episode named by video_id", async () => {
    stubStremio({
      meta: [["tt0903747", MTIME]],
      items: [
        libraryItem({
          _id: "tt0903747",
          type: "series",
          state: {
            flaggedWatched: 1,
            timesWatched: 1,
            video_id: "tt0903747:2:7",
            lastWatched: "2026-08-02T20:00:00.000Z",
          },
        }),
      ],
    });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "episode",
        imdbId: "tt0903747",
        seriesImdbId: "tt0903747",
        season: 2,
        episode: 7,
        source: "Stremio",
      })
    );
  });

  it("ignores an unwatched item", async () => {
    stubStremio({
      meta: [["tt0111161", MTIME]],
      items: [libraryItem({ state: { flaggedWatched: 0, timesWatched: 0, timeOffset: 90_000 } })],
    });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(summary.recorded).toBe(0);
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("ignores content that is not keyed by an IMDb id", async () => {
    stubStremio({
      meta: [["yt_id:UCxyz", MTIME]],
      items: [libraryItem({ _id: "yt_id:UCxyz", type: "movie" })],
    });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(summary.recorded).toBe(0);
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("ignores an episode whose video_id belongs to a different series", async () => {
    stubStremio({
      meta: [["tt0903747", MTIME]],
      items: [
        libraryItem({
          _id: "tt0903747",
          type: "series",
          state: { flaggedWatched: 1, timesWatched: 1, video_id: "tt9999999:1:1" },
        }),
      ],
    });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(summary.recorded).toBe(0);
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("ignores a foreign video_id even when the item carries its own season and episode", async () => {
    // The season/episode fallback exists for items with no video_id at all. It
    // must not rescue one that names a different series: those numbers describe
    // the foreign id, so using them would file someone else's episode here.
    stubStremio({
      meta: [["tt0903747", MTIME]],
      items: [
        libraryItem({
          _id: "tt0903747",
          type: "series",
          state: {
            flaggedWatched: 1,
            timesWatched: 1,
            video_id: "tt9999999:1:1",
            season: 4,
            episode: 2,
          },
        }),
      ],
    });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(summary.recorded).toBe(0);
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("records via season and episode when the item carries no video_id", async () => {
    stubStremio({
      meta: [["tt0903747", MTIME]],
      items: [
        libraryItem({
          _id: "tt0903747",
          type: "series",
          state: { flaggedWatched: 1, timesWatched: 1, season: 4, episode: 2 },
        }),
      ],
    });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "episode", imdbId: "tt0903747", season: 4, episode: 2 })
    );
  });

  it("fetches nothing on a second pass when the library has not changed", async () => {
    // The watermark a pass writes has to be one the *next* pass can match, or
    // the incremental path re-fetches the whole library on every poll.
    //
    // Deliberately not MTIME: `datastoreMeta` and an item's own `_mtime` are
    // different representations of the same version, and watermarking a fetched
    // item under `_mtime` only looks correct while the two happen to be spelled
    // the same. Diverging them here is what makes this a regression test.
    const metaMtime = Date.parse(MTIME);
    const fetchMock = stubStremio({ meta: [["tt0111161", metaMtime]], items: [libraryItem()] });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    await syncStremioLibrary(makeLogger(), PROFILE, "incremental");
    // Feed the first pass's own watermark back in, as the KV row would.
    prismaMock.kV.findUnique.mockResolvedValue({ value: JSON.stringify(lastWatermark()) });
    fetchMock.mockClear();

    const second = await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(second.fetched).toBe(0);
    expect(second.recorded).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("datastoreMeta");
  });

  it("does not re-record an item whose watch signature is unchanged", async () => {
    prismaMock.kV.findUnique.mockResolvedValue({
      value: JSON.stringify({ tt0111161: { m: MTIME, s: "m|1|1" } }),
    });
    // mtime moved (playback progress ticked), but the watch itself did not change.
    stubStremio({ meta: [["tt0111161", "2026-08-02T10:00:00.000Z"]], items: [libraryItem()] });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(summary.recorded).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("records a re-watched movie when Stremio's play counter increments", async () => {
    prismaMock.kV.findUnique.mockResolvedValue({
      value: JSON.stringify({ tt0111161: { m: MTIME, s: "m|1|1" } }),
    });
    stubStremio({
      meta: [["tt0111161", "2026-08-02T10:00:00.000Z"]],
      items: [libraryItem({ state: { flaggedWatched: 1, timesWatched: 2, lastWatched: "2026-08-03T09:00:00.000Z" } })],
    });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(summary.recorded).toBe(1);
  });

  it("skips the item fetch entirely when no mtime has changed", async () => {
    prismaMock.kV.findUnique.mockResolvedValue({
      value: JSON.stringify({ tt0111161: { m: MTIME, s: "m|1|1" } }),
    });
    const fetchMock = stubStremio({ meta: [["tt0111161", MTIME]] });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(summary.fetched).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("datastoreMeta");
  });

  it("baseline mode learns the state without recording anything", async () => {
    stubStremio({ items: [libraryItem()] });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "baseline");

    expect(summary.recorded).toBe(0);
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
    expect(lastWatermark()).toEqual({ tt0111161: { m: MTIME, s: "m|1|1" } });
  });

  it("import mode records what baseline mode only recorded a watermark for", async () => {
    stubStremio({ items: [libraryItem()] });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "import");

    expect(summary.recorded).toBe(1);
  });

  it("keeps going when one item fails to record, and retries it next time", async () => {
    watchEventMock.recordWatchEvent
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ status: "recorded" });
    stubStremio({
      meta: [
        ["tt0111161", MTIME],
        ["tt0068646", MTIME],
      ],
      items: [libraryItem(), libraryItem({ _id: "tt0068646" })],
    });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    const summary = await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(summary.recorded).toBe(1);
    // The failed item is absent from the watermark, so the next pass retries it.
    expect(lastWatermark()).not.toHaveProperty("tt0111161");
    expect(lastWatermark()).toHaveProperty("tt0068646");
  });

  it("surfaces a Stremio application error rather than treating it as an empty library", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ error: { code: 1, message: "Session does not exist" } }),
      })
    );
    const { syncStremioLibrary } = await import("./stremio-library.js");

    await expect(syncStremioLibrary(makeLogger(), PROFILE, "incremental")).rejects.toThrow(
      /Session does not exist/
    );
    expect(prismaMock.kV.upsert).not.toHaveBeenCalled();
  });

  it("serializes overlapping passes so a watch is recorded once, not once per caller", async () => {
    // A poll meeting a manual sync: both read the watermark before either
    // writes, so without a lock both would see the same item as new.
    stubStremio({ meta: [["tt0111161", MTIME]], items: [libraryItem()] });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    let stored: string | null = null;
    prismaMock.kV.findUnique.mockImplementation(async () => (stored ? { value: stored } : null));
    prismaMock.kV.upsert.mockImplementation(async (call: { update: { value: string } }) => {
      stored = call.update.value;
      return {};
    });

    const [first, second] = await Promise.all([
      syncStremioLibrary(makeLogger(), PROFILE, "incremental"),
      syncStremioLibrary(makeLogger(), PROFILE, "incremental"),
    ]);

    expect(first.recorded + second.recorded).toBe(1);
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-HTTPS account server rather than sending credentials in the clear", async () => {
    process.env.STREMIO_API_BASE = "http://stremio.lan";
    stubStremio({ meta: [], items: [] });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    await expect(syncStremioLibrary(makeLogger(), PROFILE, "incremental")).rejects.toThrow(/https/i);
  });

  it("keeps a path prefix on the configured account server", async () => {
    process.env.STREMIO_API_BASE = "https://proxy.example/stremio";
    const fetchMock = stubStremio({ meta: [], items: [] });
    const { syncStremioLibrary } = await import("./stremio-library.js");

    await syncStremioLibrary(makeLogger(), PROFILE, "incremental");

    expect(fetchMock.mock.calls[0][0].toString()).toBe("https://proxy.example/stremio/api/datastoreMeta");
  });

  it("stores only the authKey when connecting, never the password", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: { authKey: "secret-key" } }),
      })
    );
    const { connectStremio } = await import("./stremio-library.js");

    await connectStremio("me@example.com", "hunter2", PROFILE, makeLogger());

    const upsert = prismaMock.stremioAuth.upsert.mock.calls[0][0];
    expect(upsert.create).toEqual({
      id: "default",
      authKey: "secret-key",
      email: "me@example.com",
      profileId: PROFILE,
    });
    expect(JSON.stringify(upsert)).not.toContain("hunter2");
  });
});
