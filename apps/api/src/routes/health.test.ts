import { describe, expect, it } from "vitest";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const buildApp = () => buildRouteApp(() => import("./health.js"));

// The health endpoint is what `docker compose` waits on before starting the
// services that depend on the API, and what `pnpm smoke` checks first — so its
// shape is a contract, not an implementation detail.
describe("health route", () => {
  it("reports the service as ok", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "api" });
  });

  it("needs no database or upstream to answer", async () => {
    // Nothing is mocked in this file: if the route ever grows a dependency,
    // this test fails rather than the probe silently going unhealthy in
    // production when that dependency is down.
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
  });
});
