import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordJobSuccess = vi.fn(async () => undefined);
const recordJobFailure = vi.fn(async () => undefined);

vi.mock("./job-status.js", () => ({
  recordJobSuccess: (...args: unknown[]) => recordJobSuccess(...(args as [])),
  recordJobFailure: (...args: unknown[]) => recordJobFailure(...(args as [])),
}));

const { everyInterval, parseIntervalSec } = await import("./scheduler.js");

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const onError = vi.fn();

/** A run whose completion the test controls. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Lets every already-resolved promise in the chain settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseIntervalSec", () => {
  it("refuses a value that isn't a number rather than silently disabling the job", () => {
    // `Number("5min")` is NaN, and `NaN > 0` is false — so this used to disable
    // the Trakt poll while logging that the variable had been "set to 0".
    expect(() => parseIntervalSec("TRAKT_POLL_INTERVAL_SEC", "5min", 300)).toThrow(
      /TRAKT_POLL_INTERVAL_SEC must be a number/
    );
  });

  it("refuses a negative interval and one past the timer ceiling", () => {
    // Beyond a 32-bit signed millisecond delay, setInterval fires immediately —
    // a hammering loop rather than the long wait that was asked for.
    expect(() => parseIntervalSec("STEAM_SYNC_INTERVAL_SEC", "-1", 86400)).toThrow();
    expect(() => parseIntervalSec("STEAM_SYNC_INTERVAL_SEC", "2147484", 86400)).toThrow();
  });

  it("takes 0 as the documented way to disable a job", () => {
    expect(parseIntervalSec("AI_REFRESH_INTERVAL_SEC", "0", 86400)).toBe(0);
  });

  it("treats unset and blank alike, since compose renders an empty variable either way", () => {
    expect(parseIntervalSec("AI_REFRESH_INTERVAL_SEC", undefined, 86400)).toBe(86400);
    expect(parseIntervalSec("AI_REFRESH_INTERVAL_SEC", "  ", 86400)).toBe(86400);
  });
});

describe("everyInterval", () => {
  it("skips a tick that arrives while the previous one is still running", async () => {
    // The bug this exists for: a first-run Trakt backfill walks up to 500 pages
    // with two to three Prisma round trips per entry, outlasting the 300-second
    // poll — and a second backfill starting alongside it duplicated history,
    // since the dedup is a read-then-write with nothing to serialize it.
    const run = deferred();
    const tick = vi.fn(() => run.promise);
    const job = everyInterval({ label: "Trakt poll", intervalMs: 1000, tick, log, onError });

    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(3);

    run.resolve();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);

    job.stop();
  });

  it("keeps running after a tick throws, rather than wedging on the failure", async () => {
    const tick = vi.fn().mockRejectedValueOnce(new Error("Trakt down")).mockResolvedValue(undefined);
    const job = everyInterval({ label: "Trakt poll", intervalMs: 1000, tick, log, onError });

    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.stringContaining("Trakt poll"));

    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);

    job.stop();
  });

  it("stops scheduling once stopped", async () => {
    const tick = vi.fn(async () => undefined);
    const job = everyInterval({ label: "scrobble cleanup", intervalMs: 1000, tick, log, onError });

    await vi.advanceTimersByTimeAsync(1000);
    job.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(tick).toHaveBeenCalledTimes(1);
  });

  describe("startAfterMs", () => {
    it("defers the first run, then settles onto the interval", async () => {
      const tick = vi.fn(async () => undefined);
      const job = everyInterval({
        label: "Steam library sync",
        intervalMs: 1000,
        startAfterMs: 5000,
        tick,
        log,
        onError,
      });

      await vi.advanceTimersByTimeAsync(4999);
      expect(tick).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(tick).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2000);
      expect(tick).toHaveBeenCalledTimes(3);

      job.stop();
    });

    it("cancels a deferred first run that never happened", async () => {
      const tick = vi.fn(async () => undefined);
      const job = everyInterval({ label: "Steam library sync", intervalMs: 1000, startAfterMs: 5000, tick, log, onError });

      job.stop();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(tick).not.toHaveBeenCalled();
    });
  });

  describe("runJob", () => {
    it("records how long each job took, against the interval it is scheduled on", async () => {
      const job = everyInterval({
        label: "Trakt poll",
        intervalMs: 1000,
        tick: async ({ runJob }) => {
          await runJob("trakt-history-poll", async () => {
            await vi.advanceTimersByTimeAsync(250);
          });
        },
        log,
        onError,
      });

      await vi.advanceTimersByTimeAsync(1000);

      expect(recordJobSuccess).toHaveBeenCalledWith("trakt-history-poll", {
        durationMs: 250,
        intervalMs: 1000,
      });

      job.stop();
    });

    it("records a failure without letting it stop the jobs behind it in the tick", async () => {
      const watchlistSync = vi.fn(async () => undefined);
      const job = everyInterval({
        label: "Trakt poll",
        intervalMs: 1000,
        tick: async ({ runJob }) => {
          await runJob("trakt-history-poll", () => Promise.reject(new Error("429 from Trakt")));
          await runJob("trakt-watchlist-sync", watchlistSync);
        },
        log,
        onError,
      });

      await vi.advanceTimersByTimeAsync(1000);

      expect(recordJobFailure).toHaveBeenCalledWith(
        "trakt-history-poll",
        expect.objectContaining({ message: "429 from Trakt" }),
        expect.objectContaining({ intervalMs: 1000 })
      );
      expect(onError).toHaveBeenCalledTimes(1);
      expect(watchlistSync).toHaveBeenCalledTimes(1);
      expect(recordJobSuccess).toHaveBeenCalledWith("trakt-watchlist-sync", expect.anything());

      job.stop();
    });

    it("survives a job-status write that fails, which is the database being down too", async () => {
      recordJobSuccess.mockRejectedValueOnce(new Error("no connection"));
      const job = everyInterval({
        label: "scrobble cleanup",
        intervalMs: 1000,
        tick: ({ runJob }) => runJob("scrobble-cleanup", async () => undefined),
        log,
        onError,
      });

      await vi.advanceTimersByTimeAsync(1000);
      expect(log.error).toHaveBeenCalledWith(expect.any(Error), expect.stringContaining("scrobble-cleanup"));

      await vi.advanceTimersByTimeAsync(1000);
      expect(recordJobSuccess).toHaveBeenCalledTimes(2);

      job.stop();
    });
  });
});
