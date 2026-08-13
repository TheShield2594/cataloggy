import type { FastifyBaseLogger } from "fastify";
import { recordJobFailure, recordJobSuccess, type JobName } from "./job-status.js";

// setInterval/setTimeout delays are a 32-bit signed int under the hood; anything
// larger fires (near-)immediately instead of after the intended wait, so a
// hammered sync loop is a real risk if one of these is misconfigured.
export const MAX_TIMER_DELAY_SEC = 2_147_483_647 / 1000;

/**
 * Reads a scheduled job's interval out of the environment, refusing to start on
 * a value that isn't one.
 *
 * Reading one as `Number(raw ?? fallback)` — what every interval but the Steam
 * one used to do — yields `NaN` for a typo, and `NaN > 0` is false, so a
 * mistyped value silently disabled the job while the startup log claimed the
 * variable had been "set to 0". A misconfigured interval is now a startup error
 * that names it.
 *
 * A blank value is treated as unset rather than as zero: that is what an env
 * file with `TRAKT_POLL_INTERVAL_SEC=` and a compose default produces, and
 * reading it as "disabled" would turn a formatting slip into a silent stop.
 */
export function parseIntervalSec(name: string, raw: string | undefined, defaultSec: number): number {
  if (raw === undefined || raw.trim() === "") return defaultSec;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_TIMER_DELAY_SEC) {
    throw new Error(
      `${name} must be a number between 0 and ${Math.floor(MAX_TIMER_DELAY_SEC)} (got "${raw}"). Set it to 0 to disable it.`
    );
  }
  return parsed;
}

type SchedulerLogger = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

/**
 * Runs one named job, recording its outcome and how long it took. Never throws:
 * a job that fails is reported and the rest of the tick carries on, which is
 * what the hand-rolled `.then(success).catch(report)` chains at each call site
 * used to do individually.
 */
export type RunJob = (job: JobName, run: () => Promise<unknown>) => Promise<void>;

export type ScheduleOptions = {
  /** Names the whole tick in logs — several jobs can share one. */
  label: string;
  intervalMs: number;
  /** Delay before the first run. Omit to wait one full interval, as `setInterval` does. */
  startAfterMs?: number;
  tick: (context: { runJob: RunJob }) => Promise<void>;
  log: SchedulerLogger;
  /** Reports to the log and to Sentry; job status is recorded here. */
  onError: (error: unknown, message: string) => void;
};

export type ScheduledJob = { stop: () => void };

/**
 * Runs `tick` on an interval, never concurrently with itself.
 *
 * Every scheduler here used to be a bare `setInterval(() => { void job() }, n)`
 * with nothing tracking whether the previous tick had finished. A first-run
 * Trakt backfill walks up to 500 pages and issues two to three sequential
 * Prisma round trips per history entry, which on a large account comfortably
 * outlasts the 300-second poll interval — at which point a second backfill
 * started alongside the first. Since the dedup there is a read-then-write with
 * no unique constraint covering the non-Trakt path, both passes saw "no
 * existing event" and both created one: duplicated watch history.
 *
 * A tick that arrives while the previous one is still running is dropped rather
 * than queued. These are all polls — the next tick covers the same ground —
 * so queueing a second pass behind one that is already too slow only compounds
 * the overrun. (`stremio-library.ts` queues instead, and is right to: a manual
 * "Sync now" or an import must not be silently skipped. That lock stays where
 * it is, guarding the pass itself against callers other than this scheduler.)
 */
export function everyInterval({
  label,
  intervalMs,
  startAfterMs,
  tick,
  log,
  onError,
}: ScheduleOptions): ScheduledJob {
  let inFlight = false;
  let firstRunTimer: NodeJS.Timeout | undefined;
  let intervalTimer: NodeJS.Timeout | undefined;

  const persist = (job: JobName, write: Promise<void>) =>
    write.catch((error: unknown) => {
      log.error(error, `Failed to persist job status for ${job}`);
    });

  const runJob: RunJob = async (job, run) => {
    const startedAt = Date.now();
    try {
      await run();
      await persist(job, recordJobSuccess(job, { durationMs: Date.now() - startedAt, intervalMs }));
    } catch (error) {
      onError(error, `Scheduled ${job} failed`);
      await persist(job, recordJobFailure(job, error, { durationMs: Date.now() - startedAt, intervalMs }));
    }
  };

  const runTick = async () => {
    if (inFlight) {
      // Worth a warning rather than silence: a job that regularly outlasts its
      // interval is a configuration problem, and the run it overlapped with
      // records the duration that explains it (surfaced in Settings → Sync
      // Status).
      log.warn(
        { job: label, intervalMs },
        `Skipping this ${label} run: the previous one is still in flight`
      );
      return;
    }

    inFlight = true;
    try {
      await tick({ runJob });
    } catch (error) {
      // Only reached by a failure outside any runJob call — resolving which
      // profile to sync, say. Job-scoped failures are recorded by runJob.
      onError(error, `Scheduled ${label} failed`);
    } finally {
      inFlight = false;
    }
  };

  const startInterval = () => {
    intervalTimer = setInterval(() => void runTick(), intervalMs);
  };

  if (startAfterMs === undefined) {
    startInterval();
  } else {
    firstRunTimer = setTimeout(() => {
      firstRunTimer = undefined;
      void runTick();
      startInterval();
    }, startAfterMs);
  }

  return {
    stop: () => {
      // Held apart so each is cancelled by its own function. Node treats the two
      // as interchangeable, but a scheduler that says which kind of timer it is
      // cancelling is worth more than the line it saves.
      if (firstRunTimer) clearTimeout(firstRunTimer);
      if (intervalTimer) clearInterval(intervalTimer);
      firstRunTimer = undefined;
      intervalTimer = undefined;
    },
  };
}
