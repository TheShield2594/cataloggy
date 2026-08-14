import { prisma } from "./prisma.js";
import { withDeadline } from "./deadline.js";

// The one question a readiness probe has to answer: can this process still get
// a connection and run a statement?
//
// `SELECT 1` is chosen because it touches no table and no row, so it stays
// correct across migrations and costs nothing to run every ten seconds. What it
// does exercise is the part that actually breaks — the pool. A container whose
// connections have all been checked out by a stuck query is exactly the case
// the old unconditional `{status:"ok"}` reported as healthy while every real
// request queued behind it.
//
// Hence the deadline: without one this probe inherits the same unbounded wait
// as the requests it is meant to warn about, and Docker's healthcheck timeout
// would be the only thing ending it. Two seconds is far longer than a local
// `SELECT 1` (sub-millisecond) and well inside the 5s healthcheck timeout in
// docker-compose.yml.
export const DATABASE_PROBE_TIMEOUT_MS = 2000;

const MAX_ERROR_LENGTH = 200;

export type DatabaseHealth = {
  ok: boolean;
  latencyMs: number;
  /** The failure, for logs and the token-guarded `/metrics`; null when ok. */
  error: string | null;
};

const describe = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);

export async function checkDatabase(timeoutMs: number = DATABASE_PROBE_TIMEOUT_MS): Promise<DatabaseHealth> {
  const startedAt = performance.now();

  try {
    await withDeadline(prisma.$queryRaw`SELECT 1`, timeoutMs, `Database probe timed out after ${timeoutMs}ms`);
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt), error: null };
  } catch (error) {
    return { ok: false, latencyMs: Math.round(performance.now() - startedAt), error: describe(error) };
  }
}
