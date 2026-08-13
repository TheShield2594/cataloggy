import { prisma } from "./prisma.js";

// Persists the outcome of each scheduled background job's last run to the KV
// table so a self-hoster without Sentry configured (the default — no error data
// leaves the server unless opted in) can still notice a silently-broken sync
// from the Settings page, instead of it only ever showing up in server logs.
const JOB_STATUS_KEY_PREFIX = "job-status:";

export type JobName =
  | "trakt-history-poll"
  | "trakt-watchlist-sync"
  | "stremio-library-sync"
  | "stremio-play-signals"
  | "scrobble-cleanup"
  | "episode-notifications"
  | "ai-recommendations"
  | "steam-sync";

const MAX_MESSAGE_LENGTH = 2000;

/** How long the run took, and the interval it is scheduled on. */
export type JobTiming = { durationMs: number; intervalMs?: number };

type StoredRun = {
  status: "ok" | "failed";
  message?: string;
  durationMs?: number;
  overran?: boolean;
};

// A run that outlasts its own interval is the shape of the overlap bug the
// scheduler's in-flight guard now prevents: the tick it collided with was
// dropped, so the job is effectively running less often than configured. Worth
// surfacing rather than leaving in a log line nobody reads.
const didOverrun = (timing: JobTiming | undefined): boolean =>
  timing?.intervalMs !== undefined && timing.durationMs > timing.intervalMs;

const write = async (job: JobName, run: StoredRun): Promise<void> => {
  const key = JOB_STATUS_KEY_PREFIX + job;
  const value = JSON.stringify(run);
  const now = new Date();
  await prisma.kV.upsert({
    where: { key },
    create: { key, value, updatedAt: now },
    update: { value, updatedAt: now },
  });
};

export async function recordJobFailure(job: JobName, error: unknown, timing?: JobTiming): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_MESSAGE_LENGTH);
  await write(job, {
    status: "failed",
    message,
    ...(timing ? { durationMs: timing.durationMs, overran: didOverrun(timing) } : {}),
  });
}

export async function recordJobSuccess(job: JobName, timing?: JobTiming): Promise<void> {
  await write(job, {
    status: "ok",
    ...(timing ? { durationMs: timing.durationMs, overran: didOverrun(timing) } : {}),
  });
}

export type JobRun = {
  job: JobName;
  status: "ok" | "failed";
  /** The error, for a failed run; null for a successful one. */
  message: string | null;
  /** Wall-clock duration, or null for a run recorded before durations were. */
  durationMs: number | null;
  /** The run outlasted its own interval, so the tick that followed was dropped. */
  overran: boolean;
  at: string;
};

export type JobFailure = { job: JobName; message: string; failedAt: string };

// Rows written before this file stored JSON hold the bare failure message, and
// upgrading shouldn't lose the failure a self-hoster is currently looking at.
// Anything that isn't one of our own records reads as the failure it used to be.
const parseRun = (value: string): StoredRun => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      ((parsed as StoredRun).status === "ok" || (parsed as StoredRun).status === "failed")
    ) {
      return parsed as StoredRun;
    }
  } catch {
    // Not JSON at all — a legacy message.
  }
  return { status: "failed", message: value };
};

/** The last run of every job that has run since the process last started fresh. */
export async function getJobRuns(): Promise<JobRun[]> {
  const rows = await prisma.kV.findMany({
    where: { key: { startsWith: JOB_STATUS_KEY_PREFIX } },
    orderBy: { updatedAt: "desc" },
  });

  return rows.map((row) => {
    const run = parseRun(row.value);
    return {
      job: row.key.slice(JOB_STATUS_KEY_PREFIX.length) as JobName,
      status: run.status,
      message: run.message ?? null,
      durationMs: run.durationMs ?? null,
      overran: run.overran ?? false,
      at: row.updatedAt.toISOString(),
    };
  });
}

export async function getFailedJobStatuses(): Promise<JobFailure[]> {
  const runs = await getJobRuns();
  return runs
    .filter((run) => run.status === "failed")
    .map((run) => ({ job: run.job, message: run.message ?? "", failedAt: run.at }));
}
