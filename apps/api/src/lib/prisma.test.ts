import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { first } from "./test-fixtures/present.js";

// The real module builds a connection pool at import time, so both dependencies
// are replaced wholesale: what is under test is the wiring between Prisma's log
// events and the app's logger, not either library.
const listeners = new Map<string, (event: unknown) => void>();
const clientOptions: Record<string, unknown>[] = [];
const adapterConfigs: Record<string, unknown>[] = [];

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    constructor(options: Record<string, unknown>) {
      clientOptions.push(options);
    }
    $on(event: string, listener: (event: unknown) => void) {
      listeners.set(event, listener);
    }
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(config: Record<string, unknown>) {
      adapterConfigs.push(config);
    }
  },
}));

const logger = { warn: vi.fn(), error: vi.fn() };

const load = async (env: Record<string, string | undefined> = {}) => {
  vi.resetModules();
  listeners.clear();
  clientOptions.length = 0;
  adapterConfigs.length = 0;

  process.env.DATABASE_URL = "postgresql://postgres:postgres@db:5432/cataloggy";
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  const module = await import("./prisma.js");
  module.attachDatabaseLogging(logger as never);
  return module;
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  logger.warn.mockClear();
  logger.error.mockClear();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("the pool the adapter is built with", () => {
  it("is bounded, and cancels a statement rather than holding a connection forever", async () => {
    await load();

    expect(adapterConfigs[0]).toMatchObject({
      connectionString: "postgresql://postgres:postgres@db:5432/cataloggy",
      max: 10,
      statement_timeout: 30_000,
      application_name: "cataloggy-api",
    });
    // Without this a caller waits out the exhaustion it is queued behind.
    expect(first(adapterConfigs, "adapter config").connectionTimeoutMillis).toBeGreaterThan(0);
    expect(first(adapterConfigs, "adapter config").idleTimeoutMillis).toBeGreaterThan(0);
  });

  it("takes the bounds from the environment", async () => {
    await load({ DATABASE_POOL_MAX: "42", DATABASE_STATEMENT_TIMEOUT_MS: "5000" });

    expect(adapterConfigs[0]).toMatchObject({ max: 42, statement_timeout: 5_000 });
  });

  it("passes false, not 0, when the statement timeout is turned off", async () => {
    // node-postgres reads 0 as "cancel immediately", which would fail every query.
    await load({ DATABASE_STATEMENT_TIMEOUT_MS: "0" });

    expect(first(adapterConfigs, "adapter config").statement_timeout).toBe(false);
  });

  it("refuses to load at all without a connection string", async () => {
    vi.resetModules();
    delete process.env.DATABASE_URL;

    await expect(import("./prisma.js")).rejects.toThrow(/DATABASE_URL is not set/);
  });
});

describe("attachDatabaseLogging", () => {
  it("logs a query at or past the threshold, with its duration and SQL", async () => {
    await load({ DATABASE_SLOW_QUERY_MS: "100" });

    listeners.get("query")!({ duration: 250.4, query: "SELECT 1", params: "[]" });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(first(logger.warn.mock.calls, "logger.warn call")[0]).toEqual({ durationMs: 250, query: "SELECT 1" });
    expect(first(logger.warn.mock.calls, "logger.warn call")[1]).toMatch(/250ms/);
  });

  it("never logs the parameters, which carry stored credentials and PIN hashes", async () => {
    await load({ DATABASE_SLOW_QUERY_MS: "100" });

    listeners.get("query")!({
      duration: 900,
      query: 'INSERT INTO "KV" ("key","value") VALUES ($1,$2)',
      params: '["tmdb:apiKey","cgy1.aaa.bbb.ccc"]',
    });

    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("cgy1.aaa.bbb.ccc");
  });

  it("stays quiet for a query under the threshold", async () => {
    await load({ DATABASE_SLOW_QUERY_MS: "100" });

    listeners.get("query")!({ duration: 99, query: "SELECT 1", params: "[]" });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("subscribes to no query events at all when the threshold is 0", async () => {
    await load({ DATABASE_SLOW_QUERY_MS: "0" });

    expect(listeners.has("query")).toBe(false);
    // The client still asks for them, so warn/error stay wired.
    expect(listeners.has("warn")).toBe(true);
  });

  it("forwards Prisma's own warnings and errors", async () => {
    await load();

    listeners.get("warn")!({ target: "postgres", message: "connection pool timeout" });
    listeners.get("error")!({ target: "postgres", message: "connection closed" });

    expect(logger.warn).toHaveBeenCalledWith({ target: "postgres" }, "connection pool timeout");
    expect(logger.error).toHaveBeenCalledWith({ target: "postgres" }, "connection closed");
  });

  it("ignores a second call rather than logging every line twice", async () => {
    const module = await load({ DATABASE_SLOW_QUERY_MS: "100" });
    const first = listeners.get("query");

    module.attachDatabaseLogging(logger as never);

    expect(listeners.get("query")).toBe(first);
  });
});
