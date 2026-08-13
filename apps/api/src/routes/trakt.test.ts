import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const prismaMock = {
  kV: { create: vi.fn(), deleteMany: vi.fn() },
  traktToken: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
};

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

vi.mock("../lib/trakt-client.js", () => ({
  getTraktClient: vi.fn(),
  resetTraktClient: vi.fn(),
  pollTraktHistory: vi.fn(),
  syncTraktWatchlist: vi.fn(),
  computeTokenExpiresAt: () => new Date("2026-01-01T00:00:00Z"),
}));

vi.mock("../lib/tmdb-client.js", () => ({ getTmdb: async () => ({}) }));
vi.mock("../lib/metadata.js", () => ({ upsertMetadata: vi.fn() }));
vi.mock("../lib/series-progress.js", () => ({ upsertSeriesProgressIfNewer: vi.fn() }));
vi.mock("../lib/watchlist.js", () => ({ getDefaultWatchlist: vi.fn() }));
vi.mock("../lib/profile.js", () => ({
  getDefaultProfileId: async () => "11111111-1111-4111-8111-111111111111",
  resolveProfile: async () => {},
}));

const buildApp = (): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./trakt.js"));

const STATE = "a".repeat(64);
const originalEnv = { ...process.env };

describe("trakt OAuth — the callback is bound to the flow that started it", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TRAKT_CLIENT_ID = "client-id";
    process.env.TRAKT_CLIENT_SECRET = "client-secret";
    prismaMock.kV.create.mockResolvedValue({});
    prismaMock.kV.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.traktToken.upsert.mockResolvedValue({});
    vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("puts a state in the authorize URL and persists it", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/trakt/oauth/authorize" });

    const state = new URL(response.json().url).searchParams.get("state");
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(prismaMock.kV.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: `trakt:oauth:state:${state}` }) })
    );
  });

  it("rejects a callback with no state at all, without exchanging the code", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/trakt/oauth/callback?code=attacker-code" });

    expect(response.statusCode).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(prismaMock.traktToken.upsert).not.toHaveBeenCalled();
  });

  it("rejects a callback whose state this install never issued (or already used)", async () => {
    prismaMock.kV.deleteMany.mockResolvedValue({ count: 0 });
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/trakt/oauth/callback?code=attacker-code&state=${STATE}`,
    });

    expect(response.statusCode).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(prismaMock.traktToken.upsert).not.toHaveBeenCalled();
  });

  it("exchanges the code and stores the tokens when the state matches", async () => {
    prismaMock.kV.deleteMany.mockResolvedValue({ count: 1 });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/trakt/oauth/callback?code=real-code&state=${STATE}`,
    });

    expect(response.statusCode).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith("https://api.trakt.tv/oauth/token", expect.anything());
    expect(prismaMock.traktToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ accessToken: "access" }) })
    );
  });

  it("stores both tokens encrypted when API_TOKEN is set", async () => {
    process.env.API_TOKEN = "trakt-route-token";
    prismaMock.kV.deleteMany.mockResolvedValue({ count: 1 });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const { SECRET_CONTEXT, decryptSecret } = await import("../lib/secret-box.js");
    const app = await buildApp();

    await app.inject({ method: "GET", url: `/trakt/oauth/callback?code=real-code&state=${STATE}` });

    const { accessToken, refreshToken } = prismaMock.traktToken.upsert.mock.calls[0][0].update;
    expect(accessToken).not.toBe("access");
    expect(refreshToken).not.toBe("refresh");
    // Each half is bound to its own column, so the pair can't be swapped.
    expect(decryptSecret(SECRET_CONTEXT.traktAccessToken, accessToken)).toBe("access");
    expect(decryptSecret(SECRET_CONTEXT.traktRefreshToken, refreshToken)).toBe("refresh");
    expect(decryptSecret(SECRET_CONTEXT.traktAccessToken, refreshToken)).toBeNull();
  });

  it("still reports a denial from Trakt rather than a state failure", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/trakt/oauth/callback?error=access_denied&error_description=User+said+no",
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain("User said no");
  });
});
