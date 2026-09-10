import type { FastifyBaseLogger } from "fastify";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  IDLE_IN_TRANSACTION_TIMEOUT_MS,
  POOL_CONNECTION_TIMEOUT_MS,
  POOL_IDLE_TIMEOUT_MS,
  parsePoolMax,
  parseSlowQueryMs,
  parseStatementTimeoutMs,
  requireDatabaseUrl,
} from "./db-config.js";

const statementTimeoutMs = parseStatementTimeoutMs(process.env.DATABASE_STATEMENT_TIMEOUT_MS);
const slowQueryMs = parseSlowQueryMs(process.env.DATABASE_SLOW_QUERY_MS);

const adapter = new PrismaPg({
  connectionString: requireDatabaseUrl(process.env.DATABASE_URL),
  max: parsePoolMax(process.env.DATABASE_POOL_MAX),
  idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
  // `false` is node-postgres's own way of saying "no limit"; 0 would be read as
  // a zero-millisecond timeout and cancel everything.
  statement_timeout: statementTimeoutMs === 0 ? false : statementTimeoutMs,
  idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
  // Names these connections in `pg_stat_activity`, so an operator looking at a
  // busy database can tell the API's connections from the migrate container's
  // and from their own psql session.
  application_name: "cataloggy-api",
});

export const prisma = new PrismaClient({
  adapter,
  // Events rather than Prisma's stdout logging: everything else this process
  // writes goes through Fastify's structured logger, and a second format
  // interleaved with it is the kind of log nothing can filter.
  log: [
    { emit: "event", level: "query" },
    { emit: "event", level: "warn" },
    { emit: "event", level: "error" },
  ],
});

let loggingAttached = false;

/**
 * Routes Prisma's own warnings and errors — and any query slower than
 * `DATABASE_SLOW_QUERY_MS` — into the app's logger.
 *
 * Separate from constructing the client because the logger belongs to the
 * Fastify instance, which is built after this module is imported. Called once
 * from `index.ts`; calling it again is a no-op rather than a second set of
 * listeners writing every line twice.
 *
 * Query *parameters* are deliberately not logged. They carry whatever was being
 * written — an encrypted credential, a profile PIN hash, a note — and the point
 * of a slow-query line is which statement was slow, which the SQL alone answers.
 */
export const attachDatabaseLogging = (logger: FastifyBaseLogger): void => {
  if (loggingAttached) return;
  loggingAttached = true;

  prisma.$on("warn", (event) => logger.warn({ target: event.target }, event.message));
  prisma.$on("error", (event) => logger.error({ target: event.target }, event.message));

  if (slowQueryMs === 0) return;

  prisma.$on("query", (event) => {
    if (event.duration < slowQueryMs) return;
    logger.warn(
      { durationMs: Math.round(event.duration), query: event.query },
      `Database query took ${Math.round(event.duration)}ms`
    );
  });
};
