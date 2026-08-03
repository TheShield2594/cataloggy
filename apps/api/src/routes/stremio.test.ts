import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const OWN_LIST_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_LIST_ID = "44444444-4444-4444-8444-444444444444";

const prismaMock = {
  profile: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  list: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  kV: { findUnique: vi.fn(), upsert: vi.fn() },
};

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

vi.mock("../lib/stremio-helpers.js", () => ({
  getWatchlistMetas: async () => [{ id: "tt0000001" }],
  getRecentMetas: async () => [],
  getContinueMetas: async () => [],
  getCustomListMetas: async () => [{ id: "tt0000002" }],
}));

vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
  getDefaultProfileId: async () => PROFILE_ID,
}));

vi.mock("../lib/ai.js", () => ({
  isAiConfigured: async () => false,
  getAiRecommendations: async () => null,
}));

vi.mock("../lib/tmdb-client.js", () => ({ getTmdb: async () => ({}) }));

const resetMocks = () => {
  vi.clearAllMocks();
  prismaMock.list.findMany.mockResolvedValue([]);
  prismaMock.list.findFirst.mockResolvedValue(null);
  prismaMock.kV.findUnique.mockResolvedValue(null);
  prismaMock.kV.upsert.mockResolvedValue({});
  prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID });
  prismaMock.profile.findMany.mockResolvedValue([{ id: PROFILE_ID }, { id: OTHER_PROFILE_ID }]);
};

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: stremioRoutes } = await import("./stremio.js");
  const app = Fastify();
  await app.register(stremioRoutes);
  await app.ready();
  return app;
};

describe("stremio routes — addon config is per profile", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("GET /addon/config", () => {
    it("only offers the requesting profile's custom lists", async () => {
      prismaMock.list.findMany.mockResolvedValue([{ id: OWN_LIST_ID, name: "Weekend" }]);
      const app = await buildApp();

      const response = await app.inject({ method: "GET", url: "/addon/config" });

      expect(response.statusCode).toBe(200);
      expect(response.json().availableLists).toEqual([{ id: OWN_LIST_ID, name: "Weekend" }]);
      expect(prismaMock.list.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ profileId: PROFILE_ID }) })
      );
      await app.close();
    });

    it("reads the config row belonging to the requesting profile", async () => {
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/addon/config" });

      expect(prismaMock.kV.findUnique).toHaveBeenCalledWith({
        where: { key: `addon:config:${PROFILE_ID}` },
      });
      await app.close();
    });

    it("falls back to the default catalogs when the profile has no config row", async () => {
      const app = await buildApp();

      const response = await app.inject({ method: "GET", url: "/addon/config" });

      expect(response.json().config.enabledCatalogs).toContain("cataloggy-trending-movie");
      await app.close();
    });
  });

  describe("POST /addon/config", () => {
    it("writes to the requesting profile's own config row", async () => {
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/addon/config",
        payload: { enabledCatalogs: ["cataloggy-anime-series"] },
      });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.kV.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: `addon:config:${PROFILE_ID}` } })
      );
      await app.close();
    });

    it("drops a list catalog that belongs to another profile", async () => {
      // The scoped lookup returns only the caller's list, so the other
      // profile's id fails validation and never reaches the stored config.
      prismaMock.list.findMany.mockResolvedValue([{ id: OWN_LIST_ID }]);
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: "/addon/config",
        payload: { enabledCatalogs: [`list:${OWN_LIST_ID}`, `list:${OTHER_LIST_ID}`] },
      });

      expect(response.json().config.enabledCatalogs).toEqual([`list:${OWN_LIST_ID}`]);
      await app.close();
    });

    it("rejects a body without an enabledCatalogs array", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/addon/config", payload: {} });
      expect(response.statusCode).toBe(400);
      expect(prismaMock.kV.upsert).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe("GET /addon/stremio/manifest.json", () => {
    it("reads the config of the profile named in the query string", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: OTHER_PROFILE_ID });
      const app = await buildApp();

      const response = await app.inject({
        method: "GET",
        url: `/addon/stremio/manifest.json?profileId=${OTHER_PROFILE_ID}`,
      });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.kV.findUnique).toHaveBeenCalledWith({
        where: { key: `addon:config:${OTHER_PROFILE_ID}` },
      });
      await app.close();
    });

    it("falls back to the default profile when no profileId is given", async () => {
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/addon/stremio/manifest.json" });

      expect(prismaMock.kV.findUnique).toHaveBeenCalledWith({
        where: { key: `addon:config:${PROFILE_ID}` },
      });
      await app.close();
    });

    it("does not advertise a list catalog owned by another profile", async () => {
      prismaMock.kV.findUnique.mockResolvedValue({
        value: JSON.stringify({ enabledCatalogs: [`list:${OTHER_LIST_ID}`] }),
      });
      // Both the config validation and the manifest's name lookup are scoped to
      // the profile, so a foreign list id resolves to nothing.
      prismaMock.list.findMany.mockResolvedValue([]);
      const app = await buildApp();

      const response = await app.inject({ method: "GET", url: "/addon/stremio/manifest.json" });

      const catalogIds = (response.json().catalogs as { id: string }[]).map((c) => c.id);
      expect(catalogIds).not.toContain(`list:${OTHER_LIST_ID}`);
      await app.close();
    });
  });
});

describe("stremio routes — the addon URL is gated by a per-profile secret", () => {
  const originalToken = process.env.API_TOKEN;

  beforeEach(() => {
    resetMocks();
    process.env.API_TOKEN = "test-api-token";
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.API_TOKEN;
    else process.env.API_TOKEN = originalToken;
  });

  const secretFor = async (profileId: string): Promise<string> => {
    const { deriveStremioSecret } = await import("../lib/stremio-secret.js");
    return deriveStremioSecret(profileId) as string;
  };

  it("serves the manifest of the profile the secret was minted for", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/addon/stremio/${await secretFor(OTHER_PROFILE_ID)}/manifest.json`,
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.kV.findUnique).toHaveBeenCalledWith({
      where: { key: `addon:config:${OTHER_PROFILE_ID}` },
    });
    await app.close();
  });

  it("ignores ?profileId — the secret, not the query string, picks the profile", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/addon/stremio/${await secretFor(PROFILE_ID)}/manifest.json?profileId=${OTHER_PROFILE_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.kV.findUnique).toHaveBeenCalledWith({
      where: { key: `addon:config:${PROFILE_ID}` },
    });
    expect(prismaMock.kV.findUnique).not.toHaveBeenCalledWith({
      where: { key: `addon:config:${OTHER_PROFILE_ID}` },
    });
    await app.close();
  });

  it("404s a manifest request carrying an unknown secret", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: `/addon/stremio/${"f".repeat(64)}/manifest.json` });

    expect(response.statusCode).toBe(404);
    expect(prismaMock.kV.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  it("serves a catalog for a valid secret and 404s the same catalog without one", async () => {
    const app = await buildApp();
    const secret = await secretFor(PROFILE_ID);

    const ok = await app.inject({
      method: "GET",
      url: `/addon/stremio/${secret}/catalog/movie/my_watchlist_movies.json`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().metas).toEqual([{ id: "tt0000001" }]);

    const rejected = await app.inject({
      method: "GET",
      url: `/addon/stremio/${"0".repeat(64)}/catalog/movie/my_watchlist_movies.json`,
    });
    expect(rejected.statusCode).toBe(404);
    expect(rejected.json().metas).toEqual([]);
    await app.close();
  });

  it("only serves a custom list catalog to the profile that owns the list", async () => {
    const app = await buildApp();
    const secret = await secretFor(PROFILE_ID);

    prismaMock.list.findFirst.mockResolvedValue({ id: OWN_LIST_ID });
    const own = await app.inject({
      method: "GET",
      url: `/addon/stremio/${secret}/catalog/movie/list:${OWN_LIST_ID}.json`,
    });
    expect(own.statusCode).toBe(200);
    expect(prismaMock.list.findFirst).toHaveBeenCalledWith({
      where: { id: OWN_LIST_ID, profileId: PROFILE_ID },
      select: { id: true },
    });

    // A list belonging to someone else is not found under this profile's scope.
    prismaMock.list.findFirst.mockResolvedValue(null);
    const foreign = await app.inject({
      method: "GET",
      url: `/addon/stremio/${secret}/catalog/movie/list:${OTHER_LIST_ID}.json`,
    });
    expect(foreign.statusCode).toBe(404);
    await app.close();
  });

  it("hands the install URL for the requesting profile back from /addon/config", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/addon/config" });

    expect(response.json().stremioManifestPath).toBe(
      `/addon/stremio/${await secretFor(PROFILE_ID)}/manifest.json`
    );
    await app.close();
  });
});
