import { prisma } from "./prisma.js";

// Persists the last failure of each scheduled background job to the KV table
// so a self-hoster without Sentry configured (the default — no error data
// leaves the server unless opted in) can still notice a silently-broken sync
// from the Settings page, instead of it only ever showing up in server logs.
const JOB_STATUS_KEY_PREFIX = "job-status:";

export type JobName =
  | "trakt-history-poll"
  | "trakt-watchlist-sync"
  | "scrobble-cleanup"
  | "episode-notifications"
  | "ai-recommendations"
  | "steam-sync";

const MAX_MESSAGE_LENGTH = 2000;

export async function recordJobFailure(job: JobName, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_MESSAGE_LENGTH);
  const now = new Date();
  await prisma.kV.upsert({
    where: { key: JOB_STATUS_KEY_PREFIX + job },
    create: { key: JOB_STATUS_KEY_PREFIX + job, value: message, updatedAt: now },
    update: { value: message, updatedAt: now },
  });
}

export async function recordJobSuccess(job: JobName): Promise<void> {
  await prisma.kV.deleteMany({ where: { key: JOB_STATUS_KEY_PREFIX + job } });
}

export type JobFailure = { job: JobName; message: string; failedAt: string };

export async function getFailedJobStatuses(): Promise<JobFailure[]> {
  const rows = await prisma.kV.findMany({
    where: { key: { startsWith: JOB_STATUS_KEY_PREFIX } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({
    job: row.key.slice(JOB_STATUS_KEY_PREFIX.length) as JobName,
    message: row.value,
    failedAt: row.updatedAt.toISOString(),
  }));
}
