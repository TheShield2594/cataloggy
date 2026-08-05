import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const getUpcomingEpisodes = vi.fn();
const getSpoilerProtection = vi.fn();

vi.mock("../lib/upcoming-episodes.js", () => ({
  getUpcomingEpisodes: (...a: unknown[]) => getUpcomingEpisodes(...a),
}));
vi.mock("../lib/settings.js", () => ({ getSpoilerProtection: () => getSpoilerProtection() }));
vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const buildApp = (): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./calendar.js"));

/** The `days` argument the route passed through to the lookup. */
const daysArg = () => getUpcomingEpisodes.mock.calls[0][1];

describe("calendar routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUpcomingEpisodes.mockResolvedValue([]);
    getSpoilerProtection.mockResolvedValue(false);
  });

  it("looks 30 days ahead by default", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/calendar" });

    expect(res.statusCode).toBe(200);
    expect(getUpcomingEpisodes).toHaveBeenCalledWith(PROFILE_ID, 30, 30, false);
  });

  it("honours an explicit window", async () => {
    const app = await buildApp();

    await app.inject({ method: "GET", url: "/calendar?days=7" });

    expect(daysArg()).toBe(7);
  });

  it("clamps a window longer than 90 days", async () => {
    const app = await buildApp();

    await app.inject({ method: "GET", url: "/calendar?days=365" });

    expect(daysArg()).toBe(90);
  });

  it("clamps a zero or negative window up to a day", async () => {
    const app = await buildApp();

    await app.inject({ method: "GET", url: "/calendar?days=-5" });

    expect(daysArg()).toBe(1);
  });

  it("falls back to the default when days is not a number", async () => {
    // `Number("soon")` is NaN, which would otherwise reach the query as-is.
    const app = await buildApp();

    await app.inject({ method: "GET", url: "/calendar?days=soon" });

    expect(daysArg()).toBe(30);
  });

  it("passes the spoiler-protection setting through", async () => {
    getSpoilerProtection.mockResolvedValue(true);
    const app = await buildApp();

    await app.inject({ method: "GET", url: "/calendar" });

    expect(getUpcomingEpisodes).toHaveBeenCalledWith(PROFILE_ID, 30, 30, true);
  });

  it("returns the calendar under a `calendar` key", async () => {
    getUpcomingEpisodes.mockResolvedValue([{ date: "2026-02-01", episodes: [] }]);
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/calendar" });

    expect(res.json().calendar).toHaveLength(1);
  });
});
