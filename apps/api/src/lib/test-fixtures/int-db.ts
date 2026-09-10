import { afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import { prisma } from "../prisma.js";
import { isSchemaValidationError, registerRequestSchemas, requestSchemaOptions } from "../request-schema.js";

// Shared fixtures for the integration suite. Importing this file is what
// enrols a test file in the per-test reset — there is no opting out, because a
// file that leaves rows behind breaks whichever file runs after it, and the
// failure would land there rather than here.

/** The tables the migrations own, minus Prisma's own bookkeeping. */
const truncatableTables = async (): Promise<string[]> => {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  return rows.map((row) => row.tablename);
};

let cachedTables: string[] | null = null;

/**
 * Empties every table.
 *
 * One TRUNCATE over all of them rather than a delete per table in dependency
 * order: CASCADE settles the foreign keys, and the ordering is then not
 * something this file has to keep in step with the schema.
 */
export const resetDatabase = async (): Promise<void> => {
  cachedTables ??= await truncatableTables();
  if (cachedTables.length === 0) return;

  const quoted = cachedTables.map((table) => `"public"."${table}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
};

beforeEach(resetDatabase);

const openApps = new Set<FastifyInstance>();

// Without this the pool's idle connections keep the process alive past the last
// test, and vitest reports a hanging worker rather than a result.
afterAll(async () => {
  for (const app of openApps) await app.close();
  openApps.clear();
  await prisma.$disconnect();
});

/**
 * A Fastify instance carrying one route plugin, wired the way `index.ts` wires it.
 *
 * Deliberately not `buildRouteApp` from this directory: that one calls
 * `vi.resetModules()` so each test sees fresh mock state, which here would build a
 * second `lib/prisma.js` — and so a second connection pool — for every app. The
 * integration suite wants exactly one client, shared with `resetDatabase` above,
 * so build the app once per file in a `beforeAll` and let the truncation between
 * tests do the isolating.
 */
export const buildIntApp = async (routes: FastifyPluginAsync): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false, ...requestSchemaOptions });
  registerRequestSchemas(app);
  app.setErrorHandler((error, _request, reply) =>
    isSchemaValidationError(error) ? reply.code(400).send({ error: error.message }) : reply.send(error)
  );
  await app.register(routes);
  await app.ready();
  openApps.add(app);
  return app;
};

/**
 * A profile to hang fixtures off.
 *
 * Created explicitly rather than via `getDefaultProfileId`, so a test that cares
 * about profile *order* (which is what "default" means — the oldest row) can
 * make two and know which is which.
 */
export const createProfile = (name = "Test") => prisma.profile.create({ data: { name } });

/** Silences the loggers that library code expects a route to have handed it. */
export const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
  level: "silent",
} as never;
