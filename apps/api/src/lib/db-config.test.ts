import { describe, expect, it } from "vitest";
import {
  DEFAULT_POOL_MAX,
  DEFAULT_SLOW_QUERY_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  parsePoolMax,
  parseSlowQueryMs,
  parseStatementTimeoutMs,
  requireDatabaseUrl,
} from "./db-config.js";

describe("parsePoolMax", () => {
  it("falls back when unset or blank", () => {
    expect(parsePoolMax(undefined)).toBe(DEFAULT_POOL_MAX);
    // What `DATABASE_POOL_MAX=` in a .env file produces — unset, not zero.
    expect(parsePoolMax("")).toBe(DEFAULT_POOL_MAX);
    expect(parsePoolMax("   ")).toBe(DEFAULT_POOL_MAX);
  });

  it("takes a value in range", () => {
    expect(parsePoolMax("25")).toBe(25);
    expect(parsePoolMax("1")).toBe(1);
    expect(parsePoolMax("100")).toBe(100);
  });

  it("refuses a pool that can never hand out a connection", () => {
    expect(() => parsePoolMax("0")).toThrow(/DATABASE_POOL_MAX/);
  });

  it("refuses values that are not whole numbers in range", () => {
    expect(() => parsePoolMax("101")).toThrow(/between 1 and 100/);
    expect(() => parsePoolMax("-1")).toThrow(/DATABASE_POOL_MAX/);
    expect(() => parsePoolMax("2.5")).toThrow(/whole number/);
    // The failure this shape exists to prevent: Number("ten") is NaN, and every
    // comparison against NaN is false, so an unguarded read accepts it.
    expect(() => parsePoolMax("ten")).toThrow(/got "ten"/);
  });
});

describe("parseStatementTimeoutMs", () => {
  it("falls back when unset", () => {
    expect(parseStatementTimeoutMs(undefined)).toBe(DEFAULT_STATEMENT_TIMEOUT_MS);
    expect(parseStatementTimeoutMs("")).toBe(DEFAULT_STATEMENT_TIMEOUT_MS);
  });

  it("takes a value in range", () => {
    expect(parseStatementTimeoutMs("120000")).toBe(120_000);
  });

  it("treats 0 as no limit", () => {
    expect(parseStatementTimeoutMs("0")).toBe(0);
  });

  it("refuses a timeout short enough to cancel healthy queries", () => {
    expect(() => parseStatementTimeoutMs("50")).toThrow(/between 1000 and 600000, or 0 to turn it off/);
  });

  it("refuses a timeout past the ceiling", () => {
    expect(() => parseStatementTimeoutMs("900000")).toThrow(/DATABASE_STATEMENT_TIMEOUT_MS/);
  });
});

describe("parseSlowQueryMs", () => {
  it("falls back when unset", () => {
    expect(parseSlowQueryMs(undefined)).toBe(DEFAULT_SLOW_QUERY_MS);
  });

  it("treats 0 as logging turned off", () => {
    expect(parseSlowQueryMs("0")).toBe(0);
  });

  it("takes a value in range", () => {
    expect(parseSlowQueryMs("250")).toBe(250);
  });

  it("refuses a threshold past the ceiling", () => {
    expect(() => parseSlowQueryMs("60001")).toThrow(/DATABASE_SLOW_QUERY_MS/);
  });
});

describe("requireDatabaseUrl", () => {
  it("returns the trimmed connection string", () => {
    expect(requireDatabaseUrl("  postgresql://u:p@db:5432/cataloggy  ")).toBe("postgresql://u:p@db:5432/cataloggy");
  });

  it("refuses a missing or blank value rather than letting pg guess", () => {
    expect(() => requireDatabaseUrl(undefined)).toThrow(/DATABASE_URL is not set/);
    expect(() => requireDatabaseUrl("")).toThrow(/DATABASE_URL is not set/);
    expect(() => requireDatabaseUrl("   ")).toThrow(/DATABASE_URL is not set/);
  });

  it("says where the value comes from, since nothing sets it by hand", () => {
    expect(() => requireDatabaseUrl(undefined)).toThrow(/docker-compose\.yml/);
  });
});
