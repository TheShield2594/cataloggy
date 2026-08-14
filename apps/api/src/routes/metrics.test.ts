import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";
import type { MetricsSnapshot } from "../lib/metrics.js";

const checkDatabase = vi.fn();
const getJobRuns = vi.fn();
const metricsSnapshot = vi.fn();

vi.mock("../lib/db-health.js", () => ({
  checkDatabase: () => checkDatabase(),
}));

vi.mock("../lib/job-status.js", () => ({
  getJobRuns: () => getJobRuns(),
}));

// The counters themselves are covered in lib/metrics.test.ts; what matters here
// is that the route hands them over intact and keeps answering when its other
// two dependencies don't.
vi.mock("../lib/metrics.js", () => ({
  metricsSnapshot: () => metricsSnapshot(),
}));

const snapshot = (overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot => ({
  requests: { total: 0, byStatusClass: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 }, routes: [] },
  upstream: [],
  ...overrides,
});

const buildApp = () => buildRouteApp(() => import("./metrics.js"));

describe("metrics route", () => {
  beforeEach(() => {
    // Reset, not just re-stub: one test asserts a dependency was never called,
    // and vitest keeps call history across tests in a file by default.
    checkDatabase.mockReset();
    getJobRuns.mockReset();
    metricsSnapshot.mockReset();
    checkDatabase.mockResolvedValue({ ok: true, latencyMs: 1, error: null });
    getJobRuns.mockResolvedValue([]);
    metricsSnapshot.mockReturnValue(snapshot());
  });

  it("reports request counters, upstream timings and the last run of every job", async () => {
    metricsSnapshot.mockReturnValue(
      snapshot({
        requests: {
          total: 2,
          byStatusClass: { "2xx": 1, "3xx": 0, "4xx": 0, "5xx": 1, other: 0 },
          routes: [
            { route: "GET /watchlist", count: 2, failures: 1, totalDurationMs: 16, maxDurationMs: 12, avgDurationMs: 8 },
          ],
        },
        upstream: [
          {
            host: "api.themoviedb.org",
            count: 1,
            failures: 0,
            totalDurationMs: 40,
            maxDurationMs: 40,
            avgDurationMs: 40,
          },
        ],
      })
    );
    getJobRuns.mockResolvedValue([
      { job: "steam-sync", status: "failed", message: "429", durationMs: 900, overran: false, at: "2026-08-12T00:00:00.000Z" },
    ]);
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/metrics" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requests.total).toBe(2);
    expect(body.requests.byStatusClass).toMatchObject({ "2xx": 1, "5xx": 1 });
    expect(body.requests.routes).toContainEqual(
      expect.objectContaining({ route: "GET /watchlist", count: 2, failures: 1 })
    );
    expect(body.upstream).toEqual([expect.objectContaining({ host: "api.themoviedb.org", count: 1 })]);
    expect(body.jobs).toEqual([expect.objectContaining({ job: "steam-sync", status: "failed", message: "429" })]);
    expect(body.jobsError).toBeNull();
  });

  it("includes the database probe and how long the process has been up", async () => {
    // Counters are per-process and reset with it, so they only mean something
    // read next to an uptime.
    checkDatabase.mockResolvedValue({ ok: false, latencyMs: 2000, error: "connection refused" });
    const app = await buildApp();

    const body = (await app.inject({ method: "GET", url: "/metrics" })).json();

    expect(body.database).toEqual({ ok: false, latencyMs: 2000, error: "connection refused" });
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(typeof body.memory.rssBytes).toBe("number");
  });

  it("still answers with counters when the job rows cannot be read", async () => {
    // The rows live in the database, so this is exactly the shape of a database
    // outage — the moment someone is most likely to be reading /metrics.
    getJobRuns.mockRejectedValue(new Error("connection terminated"));
    metricsSnapshot.mockReturnValue(
      snapshot({ requests: { total: 1, byStatusClass: { "2xx": 1, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 }, routes: [] } })
    );
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/metrics" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs).toBeNull();
    expect(body.jobsError).toBe("connection terminated");
    expect(body.requests.total).toBe(1);
  });

  it("answers even when the job-status query never comes back", async () => {
    // An exhausted connection pool does not refuse a query, it queues it — so
    // without a deadline this request hangs for as long as the fault lasts,
    // and /metrics stops answering in the one case it is read to diagnose.
    getJobRuns.mockReturnValue(new Promise(() => {}));
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/metrics" });

    expect(res.statusCode).toBe(200);
    expect(res.json().jobs).toBeNull();
    expect(res.json().jobsError).toMatch(/timed out/);
  }, 10_000);

  it("does not ask for job rows at all when the probe just failed", async () => {
    // The probe already waited out its own deadline against this database.
    // Asking it for rows now is a second wait for the same answer.
    checkDatabase.mockResolvedValue({ ok: false, latencyMs: 2000, error: "connection refused" });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/metrics" });

    expect(getJobRuns).not.toHaveBeenCalled();
    expect(res.json().jobs).toBeNull();
    expect(res.json().jobsError).toMatch(/probe/);
  });

  it("truncates the job-status error rather than pasting a Prisma stack beside the counters", async () => {
    getJobRuns.mockRejectedValue(new Error("x".repeat(5000)));
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/metrics" });

    expect(res.json().jobsError).toHaveLength(200);
  });

  it("is never cached", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/metrics" });

    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
