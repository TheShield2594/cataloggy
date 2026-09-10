// How the connection pool is sized and bounded. Kept apart from `prisma.ts`
// because importing that module builds the pool as a side effect — there is no
// way to test the parsing of a value without also opening connections.
//
// Every one of these has a default that is right for the documented deployment
// (one API container, one household). They are settable because the two limits
// that matter — how many connections and how long a statement may run — are the
// two an unusual library size actually pushes against, and discovering that
// means editing the image otherwise.

/**
 * Connections the API may hold open at once.
 *
 * Ten rather than pg's own ten-by-accident: the number is chosen here so it is
 * visible, and so the relationship with Postgres's `max_connections` (100 by
 * default, shared with the migrate container and any psql session) is stated
 * rather than left to two libraries' defaults to agree on.
 */
export const DEFAULT_POOL_MAX = 10;

/**
 * How long a single statement may run before Postgres cancels it.
 *
 * The unbounded case is the one this exists for: `/watch/stats/detailed` runs
 * two CTEs over the whole of a profile's history, and a Trakt backfill issues
 * thousands of statements in sequence. Without a limit, one of those going
 * pathological holds its connection until the client gives up — and with ten
 * connections in the pool, ten of them wedge the service. Thirty seconds is far
 * longer than any query this app issues on a plausible library and far shorter
 * than "forever".
 */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

/** Queries at or above this are logged. See `attachDatabaseLogging`. */
export const DEFAULT_SLOW_QUERY_MS = 1_000;

/**
 * A connection is only waited on this long before the request fails.
 *
 * Not configurable: the point is that a caller finds out the pool is exhausted
 * rather than joining the queue behind whatever exhausted it. Ten seconds is
 * comfortably longer than a healthy checkout (sub-millisecond) and shorter than
 * the statement timeout above, so a wedged pool surfaces as errors that name the
 * pool while the statements causing it are still being cancelled.
 */
export const POOL_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Idle connections are returned to Postgres after this long, so a quiet night
 * doesn't hold ten backends open until morning.
 */
export const POOL_IDLE_TIMEOUT_MS = 30_000;

/**
 * A backstop for a transaction left open with no statement running — a client
 * that died mid-transaction, holding row locks nothing will ever release.
 *
 * Every transaction in this codebase is pure database work with no upstream call
 * between statements, and Prisma gives an interactive transaction five seconds
 * of its own, so a minute here can only be reached by something already broken.
 */
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;

type Bounds = { min: number; max: number; zeroDisables?: boolean };

const parseBounded = (name: string, raw: string | undefined, fallback: number, bounds: Bounds): number => {
  // A blank value is unset, not zero: `DATABASE_POOL_MAX=` with a compose
  // default produces exactly that, and reading it as a number would turn a
  // formatting slip into a pool of size zero.
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  const allowed =
    Number.isInteger(parsed) &&
    ((bounds.zeroDisables && parsed === 0) || (parsed >= bounds.min && parsed <= bounds.max));

  if (!allowed) {
    const off = bounds.zeroDisables ? ", or 0 to turn it off" : "";
    throw new Error(`${name} must be a whole number between ${bounds.min} and ${bounds.max}${off} (got "${raw}").`);
  }

  return parsed;
};

export const parsePoolMax = (raw: string | undefined): number =>
  parseBounded("DATABASE_POOL_MAX", raw, DEFAULT_POOL_MAX, { min: 1, max: 100 });

/** Milliseconds; 0 removes the limit, which is the pre-existing behaviour. */
export const parseStatementTimeoutMs = (raw: string | undefined): number =>
  parseBounded("DATABASE_STATEMENT_TIMEOUT_MS", raw, DEFAULT_STATEMENT_TIMEOUT_MS, {
    min: 1_000,
    max: 600_000,
    zeroDisables: true,
  });

/** Milliseconds; 0 turns slow-query logging off. */
export const parseSlowQueryMs = (raw: string | undefined): number =>
  parseBounded("DATABASE_SLOW_QUERY_MS", raw, DEFAULT_SLOW_QUERY_MS, {
    min: 1,
    max: 60_000,
    zeroDisables: true,
  });

/**
 * The connection string, or a startup error naming what is missing.
 *
 * `prisma.ts` is imported by nearly every module, so it builds its adapter long
 * before `index.ts` reaches its production configuration guard. Passing an
 * undefined connection string to node-postgres does not fail there either — it
 * falls back to `PGHOST`/`PGUSER` and the local Unix socket, so the first
 * symptom used to be a query failing against a database nobody configured,
 * naming an OS username nothing in the compose file mentions. Refusing here
 * makes it the first line in the log instead.
 */
export const requireDatabaseUrl = (raw: string | undefined): string => {
  const url = raw?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The API cannot start without a database connection string — " +
        "see DATABASE_URL in docker-compose.yml, which builds it from POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB in your .env."
    );
  }
  return url;
};
