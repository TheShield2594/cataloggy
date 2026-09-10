import { defineConfig } from "vitest/config";

// The integration suite: the same code the unit tests mock Prisma out of, run
// against a real Postgres carrying the real migrations. What it is for is the
// half of the schema a mock cannot express — the partial unique indexes, the
// cascade rules, the column types — and which therefore had nothing checking it.
//
// It runs under `pnpm test:int`, never under `pnpm test`, because it TRUNCATES
// every table between tests. That is also why it refuses to use `DATABASE_URL`:
// a developer who followed the README has that pointing at their own library,
// and a suite that wipes whatever it is handed must be handed something
// deliberately. `DATABASE_URL_TEST` is that deliberate act.

const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST?.trim();

if (!DATABASE_URL_TEST) {
  throw new Error(
    "DATABASE_URL_TEST is not set. The integration suite truncates every table between tests, so it will not " +
      "run against DATABASE_URL. Point it at a throwaway database — it is created and migrated for you:\n\n" +
      "  DATABASE_URL_TEST=postgresql://postgres:postgres@127.0.0.1:5432/cataloggy_int pnpm test:int\n"
  );
}

if (DATABASE_URL_TEST === process.env.DATABASE_URL?.trim()) {
  throw new Error(
    "DATABASE_URL_TEST is the same database as DATABASE_URL. Refusing to run: this suite truncates every table " +
      "between tests, and that one is in use. Give it a database of its own."
  );
}

// The workers get it as DATABASE_URL because that is what `lib/prisma.ts` reads,
// and it is set here too so the global setup — which runs in this process —
// migrates the same database the tests then talk to.
process.env.DATABASE_URL = DATABASE_URL_TEST;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    env: {
      DATABASE_URL: DATABASE_URL_TEST,
      // One worker, one client, a handful of statements at a time. The point is
      // to leave a stock `max_connections` of 100 alone even if a future file
      // does build a second client.
      DATABASE_POOL_MAX: "4",
    },
    globalSetup: ["src/lib/test-fixtures/int-global-setup.ts"],
    // One database, one schema, one set of rows. Files running in parallel would
    // truncate each other's fixtures mid-assertion.
    fileParallelism: false,
    // Applying 36 migrations to a cold database is most of this, and it happens
    // once — but it happens inside the first file's setup budget.
    hookTimeout: 120_000,
    testTimeout: 20_000,
  },
});
