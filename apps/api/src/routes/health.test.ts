import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const checkDatabase = vi.fn();

vi.mock("../lib/db-health.js", () => ({
  checkDatabase: () => checkDatabase(),
}));

const buildApp = () => buildRouteApp(() => import("./health.js"));

// The health endpoints are what `docker compose` waits on before starting the
// services that depend on the API, and what `pnpm smoke` checks first — so
// their shape is a contract, not an implementation detail.
describe("health route", () => {
  beforeEach(() => {
    checkDatabase.mockResolvedValue({ ok: true, latencyMs: 1, error: null });
  });

  describe("GET /health (liveness)", () => {
    it("reports the service as ok", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/health" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok", service: "api" });
    });

    it("stays up when the database is down", async () => {
      // Liveness must not depend on anything this process cannot fix by
      // restarting: a 503 here has Docker restart a healthy API in a loop for
      // the duration of a database outage. Readiness is what reports that.
      checkDatabase.mockResolvedValue({ ok: false, latencyMs: 2000, error: "connection refused" });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/health" });

      expect(res.statusCode).toBe(200);
      expect(checkDatabase).not.toHaveBeenCalled();
    });
  });

  describe("GET /health/ready (readiness)", () => {
    it("reports ready with the probe's latency when the database answers", async () => {
      checkDatabase.mockResolvedValue({ ok: true, latencyMs: 3, error: null });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/health/ready" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok", service: "api", database: { ok: true, latencyMs: 3 } });
    });

    it("answers 503 when the database does not", async () => {
      checkDatabase.mockResolvedValue({ ok: false, latencyMs: 2000, error: "Database probe timed out after 2000ms" });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/health/ready" });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: "error", service: "api", database: { ok: false, latencyMs: 2000 } });
    });

    it("keeps the failure's detail out of an unauthenticated response", async () => {
      // The probe carries no API token, so the body says only that the
      // database is not answering — the error goes to the log and to the
      // token-guarded /metrics.
      checkDatabase.mockResolvedValue({
        ok: false,
        latencyMs: 5,
        error: 'password authentication failed for user "postgres"',
      });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/health/ready" });

      expect(res.payload).not.toContain("password");
    });

    it("is never cached", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/health/ready" });

      expect(res.headers["cache-control"]).toBe("no-store");
    });
  });
});
