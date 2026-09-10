import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";

// Runs once, before any integration test file: make sure the database named by
// DATABASE_URL_TEST exists and carries every migration.
//
// Doing it here rather than leaving it to the caller is what makes the suite one
// command. It also means the migrations are exercised against a database built
// only from them — which is a check of its own, and a stricter one than CI's
// existing `migrate deploy` step, because the tests then go on to use the schema
// those migrations produced.

const run = promisify(execFile);
const require = createRequire(import.meta.url);

/** Splits a connection string into "the server" and "the database on it". */
const parseTarget = (connectionString: string) => {
  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error(`DATABASE_URL_TEST names no database: ${url.protocol}//…${url.pathname}`);
  }

  // `postgres` is the maintenance database every server has, and CREATE DATABASE
  // cannot run from inside the database it is creating.
  const maintenance = new URL(url.toString());
  maintenance.pathname = "/postgres";

  return { database, maintenanceUrl: maintenance.toString() };
};

const ensureDatabaseExists = async (connectionString: string): Promise<void> => {
  const { database, maintenanceUrl } = parseTarget(connectionString);
  const client = new Client({ connectionString: maintenanceUrl });

  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (rowCount === 0) {
      // No parameters: CREATE DATABASE takes an identifier, not a value. The name
      // comes from the developer's own environment, and is quoted rather than
      // interpolated bare so a database called `my-test-db` works.
      await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
};

const applyMigrations = async (connectionString: string): Promise<void> => {
  // Resolved through Node rather than assumed to be on PATH or at a fixed
  // node_modules depth: pnpm's layout is a workspace setting (`nodeLinker`), and
  // this should not break when that changes.
  const cli = join(dirname(require.resolve("prisma/package.json")), "build", "index.js");

  await run(process.execPath, [cli, "migrate", "deploy"], {
    cwd: new URL("../../..", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: connectionString },
  });
};

export default async function setup(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // vitest.int.config.ts sets this from DATABASE_URL_TEST and refuses to load
    // without it, so reaching here means the suite was pointed at another config.
    throw new Error("Integration setup ran without DATABASE_URL — run it via `pnpm test:int`.");
  }

  await ensureDatabaseExists(connectionString);
  await applyMigrations(connectionString);
}
