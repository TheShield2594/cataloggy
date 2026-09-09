import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const isIgdbConfigured = vi.fn();

vi.mock("../lib/igdb-client.js", () => ({
  isIgdbConfigured: () => isIgdbConfigured(),
}));

const buildApp = (): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./games-igdb.js"));

describe("IGDB status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports configured when the credentials are set", async () => {
    isIgdbConfigured.mockReturnValue(true);
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/games/igdb/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: true });
  });

  // A 200 saying `false`, not an error: this route's job is to report the
  // state, so an unconfigured integration is a successful answer. The route
  // that cannot do its work without IGDB — `/games/search` — is the one that
  // declines, with a 503.
  it("reports unconfigured with a 200", async () => {
    isIgdbConfigured.mockReturnValue(false);
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/games/igdb/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false });
  });
});
