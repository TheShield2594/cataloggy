import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const MIN_AI_CONFIG_MAX_TOKENS = 2048;

const prismaMock = {
  kV: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  watchEvent: { findMany: vi.fn() },
  seriesProgress: { findMany: vi.fn() },
  metadata: { findMany: vi.fn() },
};

const trending = vi.fn();
const popular = vi.fn();
const recommendations = vi.fn();
const getTmdb = vi.fn();
const upsertMetadata = vi.fn();
const getRpdbApiKey = vi.fn();
const trendingCacheGet = vi.fn();
const trendingCacheSet = vi.fn();
const trendingCacheDeletePrefix = vi.fn();
const getAiConfig = vi.fn();
const isAiConfigured = vi.fn();
const getAiRecommendations = vi.fn();
const loadRecommendations = vi.fn();
const validateAiProviderUrl = vi.fn();
const resolveAiProviderUrl = vi.fn();

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/tmdb-client.js", () => ({ getTmdb: () => getTmdb() }));
vi.mock("../lib/metadata.js", () => ({ upsertMetadata: (...a: unknown[]) => upsertMetadata(...a) }));
vi.mock("../lib/rpdb.js", () => ({
  getRpdbApiKey: () => getRpdbApiKey(),
  applyRpdbToMetaList: (metas: unknown[]) => metas,
}));
vi.mock("../lib/cache.js", () => ({
  trendingCacheGet: (...a: unknown[]) => trendingCacheGet(...a),
  trendingCacheSet: (...a: unknown[]) => trendingCacheSet(...a),
  trendingCacheDeletePrefix: (...a: unknown[]) => trendingCacheDeletePrefix(...a),
}));
vi.mock("../lib/ai.js", () => ({
  AI_CONFIG_KEY: "ai:config",
  AI_LAST_RECS_GENERATED_AT_KEY: "ai:lastRecsGeneratedAt",
  MIN_AI_CONFIG_MAX_TOKENS,
  getAiConfig: () => getAiConfig(),
  isAiConfigured: () => isAiConfigured(),
  redactAiConfig: (c: Record<string, unknown>) => ({ ...c, headers: { Authorization: "***" } }),
  getAiRecommendations: (...a: unknown[]) => getAiRecommendations(...a),
}));
vi.mock("../lib/recommendations.js", () => ({
  loadRecommendations: (...a: unknown[]) => loadRecommendations(...a),
}));
vi.mock("../lib/ssrf.js", () => ({
  validateAiProviderUrl: (...a: unknown[]) => validateAiProviderUrl(...a),
  resolveAiProviderUrl: (...a: unknown[]) => resolveAiProviderUrl(...a),
}));
vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: aiRoutes } = await import("./ai.js");
  const app = Fastify({ logger: false });
  await app.register(aiRoutes);
  await app.ready();
  return app;
};

const tmdbResult = (over: Record<string, unknown> = {}) => ({
  imdbId: "tt1",
  tmdbId: 100,
  name: "A Title",
  poster: "p.jpg",
  year: 2020,
  description: "desc",
  genres: ["Drama"],
  rating: 7,
  ...over,
});

const validConfig = {
  url: "https://api.example.com/v1/chat/completions",
  headers: { Authorization: "Bearer sk-test" },
  payload: { model: "gpt-4o-mini" },
};

describe("ai routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTmdb.mockResolvedValue({ trending, popular, recommendations });
    trending.mockResolvedValue([tmdbResult()]);
    popular.mockResolvedValue([tmdbResult()]);
    recommendations.mockResolvedValue([tmdbResult({ imdbId: "tt2", tmdbId: 200 })]);
    upsertMetadata.mockResolvedValue(undefined);
    getRpdbApiKey.mockResolvedValue(null);
    trendingCacheGet.mockReturnValue(undefined);
    isAiConfigured.mockResolvedValue(false);
    getAiConfig.mockResolvedValue(null);
    loadRecommendations.mockResolvedValue({ metas: [] });
    validateAiProviderUrl.mockReturnValue(true);
    resolveAiProviderUrl.mockResolvedValue(true);
    prismaMock.kV.findUnique.mockResolvedValue(null);
    prismaMock.kV.upsert.mockResolvedValue({});
    prismaMock.kV.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.watchEvent.findMany.mockResolvedValue([]);
    prismaMock.seriesProgress.findMany.mockResolvedValue([]);
    prismaMock.metadata.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("GET /recommendations", () => {
    it("loads similar titles for an imdbId", async () => {
      loadRecommendations.mockResolvedValue({ metas: [{ id: "tt2" }] });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations?imdbId=tt1&type=series" });

      expect(res.statusCode).toBe(200);
      expect(loadRecommendations).toHaveBeenCalledWith("series", "series", "tt1");
      await app.close();
    });

    it("requires an imdbId", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations" });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("rejects an unsupported type", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations?imdbId=tt1&type=episode" });

      expect(res.statusCode).toBe(400);
      expect(loadRecommendations).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe("GET /recommendations/personal", () => {
    it("returns nothing when there is no watch history to seed from", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations/personal" });

      expect(res.json()).toEqual({ metas: [] });
      expect(getTmdb).not.toHaveBeenCalled();
      await app.close();
    });

    it("seeds movie recommendations from recent watches", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([{ imdbId: "tt1" }]);
      prismaMock.metadata.findMany.mockResolvedValue([{ imdbId: "tt1", tmdbId: 100 }]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations/personal" });

      expect(res.statusCode).toBe(200);
      expect(recommendations).toHaveBeenCalledWith("movie", 100);
      expect(res.json().metas).toEqual([expect.objectContaining({ id: "tt2" })]);
      await app.close();
    });

    it("seeds series recommendations from series progress", async () => {
      prismaMock.seriesProgress.findMany.mockResolvedValue([{ seriesImdbId: "tt9" }]);
      prismaMock.metadata.findMany.mockResolvedValue([{ imdbId: "tt9", tmdbId: 900 }]);
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/recommendations/personal?type=series" });

      expect(prismaMock.watchEvent.findMany).not.toHaveBeenCalled();
      expect(recommendations).toHaveBeenCalledWith("series", 900);
      await app.close();
    });

    it("never recommends a seed back to the user", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([{ imdbId: "tt1" }]);
      prismaMock.metadata.findMany.mockResolvedValue([{ imdbId: "tt1", tmdbId: 100 }]);
      recommendations.mockResolvedValue([tmdbResult({ imdbId: "tt1" })]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations/personal" });

      expect(res.json().metas).toEqual([]);
      await app.close();
    });

    it("clamps the limit to 40", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([{ imdbId: "tt1" }]);
      prismaMock.metadata.findMany.mockResolvedValue([{ imdbId: "tt1", tmdbId: 100 }]);
      recommendations.mockResolvedValue(
        Array.from({ length: 100 }, (_, i) => tmdbResult({ imdbId: `tt${i + 10}` }))
      );
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations/personal?limit=1000" });

      expect(res.json().metas).toHaveLength(40);
      await app.close();
    });

    it("prefers AI recommendations when the provider is configured", async () => {
      isAiConfigured.mockResolvedValue(true);
      getAiRecommendations.mockResolvedValue({ metas: [{ id: "ai1" }], reasons: {} });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations/personal" });

      expect(res.json().metas).toEqual([{ id: "ai1" }]);
      expect(prismaMock.watchEvent.findMany).not.toHaveBeenCalled();
      await app.close();
    });

    it("falls back to TMDB seeds when the AI call yields nothing", async () => {
      isAiConfigured.mockResolvedValue(true);
      getAiRecommendations.mockResolvedValue(null);
      prismaMock.watchEvent.findMany.mockResolvedValue([{ imdbId: "tt1" }]);
      prismaMock.metadata.findMany.mockResolvedValue([{ imdbId: "tt1", tmdbId: 100 }]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations/personal" });

      expect(res.json().metas).toEqual([expect.objectContaining({ id: "tt2" })]);
      await app.close();
    });

    it("degrades to an empty list when TMDB is unavailable", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([{ imdbId: "tt1" }]);
      prismaMock.metadata.findMany.mockResolvedValue([{ imdbId: "tt1", tmdbId: 100 }]);
      getTmdb.mockRejectedValue(new Error("no key"));
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations/personal" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ metas: [] });
      await app.close();
    });

    it("returns an empty list rather than an error for an unsupported type", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations/personal?type=episode" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ metas: [] });
      await app.close();
    });
  });

  describe("GET /recommendations/ai", () => {
    it("returns AI results with their reasons when configured", async () => {
      isAiConfigured.mockResolvedValue(true);
      getAiRecommendations.mockResolvedValue({ metas: [{ id: "tt5" }], reasons: { tt5: "because" } });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations/ai" });

      expect(res.json()).toEqual({ metas: [{ id: "tt5" }], reasons: { tt5: "because" } });
      await app.close();
    });

    it("falls back to TMDB seeds with no reasons when AI is not configured", async () => {
      prismaMock.watchEvent.findMany.mockResolvedValue([{ imdbId: "tt1" }]);
      prismaMock.metadata.findMany.mockResolvedValue([{ imdbId: "tt1", tmdbId: 100 }]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations/ai" });

      expect(res.json()).toMatchObject({ reasons: {} });
      expect(res.json().metas).toHaveLength(1);
      await app.close();
    });

    it("returns an empty result for an unsupported type", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/recommendations/ai?type=episode" });

      expect(res.json()).toEqual({ metas: [], reasons: {} });
      await app.close();
    });
  });

  describe("GET /trending and /popular", () => {
    it("fetches and caches trending titles", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/trending?type=series&window=day" });

      expect(res.statusCode).toBe(200);
      expect(trending).toHaveBeenCalledWith("series", "day");
      expect(trendingCacheSet).toHaveBeenCalledWith("trending:series:day", expect.anything());
      await app.close();
    });

    it("treats any window other than `day` as a week", async () => {
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/trending?window=month" });

      expect(trending).toHaveBeenCalledWith("movie", "week");
      await app.close();
    });

    it("serves trending from cache without calling TMDB", async () => {
      trendingCacheGet.mockReturnValue({ data: [{ id: "tt9", name: "Cached" }] });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/trending" });

      expect(res.json().metas[0].name).toBe("Cached");
      expect(getTmdb).not.toHaveBeenCalled();
      await app.close();
    });

    it("rejects an unsupported trending type", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/trending?type=episode" });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("returns 500 when TMDB is unconfigured", async () => {
      getTmdb.mockRejectedValue(new Error("no key"));
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/popular" });

      expect(res.statusCode).toBe(500);
      await app.close();
    });

    it("returns 500 and caches nothing when the popular fetch fails", async () => {
      popular.mockRejectedValue(new Error("upstream"));
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/popular" });

      expect(res.statusCode).toBe(500);
      expect(trendingCacheSet).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe("AI config", () => {
    it("redacts the stored headers when reporting the config", async () => {
      getAiConfig.mockResolvedValue(validConfig);
      prismaMock.kV.findUnique.mockResolvedValue({ value: "2026-01-01T00:00:00.000Z" });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/ai/config" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configured).toBe(true);
      expect(body.config.headers.Authorization).toBe("***");
      expect(body.lastGeneratedAt).toBe("2026-01-01T00:00:00.000Z");
      await app.close();
    });

    it("reports unconfigured when no config is stored", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/ai/config" });

      expect(res.json()).toMatchObject({ configured: false, config: null });
      await app.close();
    });

    it("saves a valid config and drops the cached recommendations", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/ai/config", payload: { config: validConfig } });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.kV.upsert).toHaveBeenCalled();
      expect(trendingCacheDeletePrefix).toHaveBeenCalledWith("ai-recs:");
      await app.close();
    });

    it("rejects a URL the SSRF guard refuses", async () => {
      validateAiProviderUrl.mockReturnValue(false);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/ai/config",
        payload: { config: { ...validConfig, url: "http://169.254.169.254/" } },
      });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.kV.upsert).not.toHaveBeenCalled();
      await app.close();
    });

    it("rejects a config with no model", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/ai/config",
        payload: { config: { ...validConfig, payload: {} } },
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("rejects headers sent as an array", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/ai/config",
        payload: { config: { ...validConfig, headers: ["Authorization: x"] } },
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("clamps a too-small max_tokens up to the floor", async () => {
      // Below the floor the model truncates its JSON mid-response, which reads
      // as "AI recommendations are broken" rather than as a config problem.
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/ai/config",
        payload: { config: { ...validConfig, payload: { model: "m", max_tokens: 16 } } },
      });

      expect(res.statusCode).toBe(200);
      const saved = JSON.parse(prismaMock.kV.upsert.mock.calls[0][0].create.value);
      expect(saved.payload.max_tokens).toBe(MIN_AI_CONFIG_MAX_TOKENS);
      await app.close();
    });

    it("keeps a max_tokens already above the floor", async () => {
      const app = await buildApp();

      await app.inject({
        method: "POST",
        url: "/ai/config",
        payload: { config: { ...validConfig, payload: { model: "m", max_tokens: 8000 } } },
      });

      const saved = JSON.parse(prismaMock.kV.upsert.mock.calls[0][0].create.value);
      expect(saved.payload.max_tokens).toBe(8000);
      await app.close();
    });

    it("rejects a negative max_tokens", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/ai/config",
        payload: { config: { ...validConfig, payload: { model: "m", max_tokens: -1 } } },
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("clears both the config and the last-generated marker on delete", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: "/ai/config" });

      expect(res.json()).toEqual({ configured: false });
      expect(prismaMock.kV.deleteMany).toHaveBeenCalledWith({
        where: { key: { in: ["ai:config", "ai:lastRecsGeneratedAt"] } },
      });
      await app.close();
    });
  });

  describe("POST /ai/test", () => {
    it("reports the provider's reply on success", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ choices: [{ message: { content: " OK " } }] }),
        })
      );
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/ai/test", payload: { config: validConfig } });

      expect(res.json()).toEqual({ success: true, response: "OK" });
      await app.close();
    });

    it("does not follow redirects, so an allowed host cannot bounce the request inward", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "OK" } }] }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const app = await buildApp();

      await app.inject({ method: "POST", url: "/ai/test", payload: { config: validConfig } });

      expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error" });
      await app.close();
    });

    it("reports only the status code, never the upstream body", async () => {
      // Echoing the body would turn this endpoint into an SSRF probe.
      const secret = "internal service says: db password is hunter2";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: secret }) })
      );
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/ai/test", payload: { config: validConfig } });

      expect(res.json()).toEqual({ success: false, error: "HTTP 500" });
      expect(res.body).not.toContain("hunter2");
      await app.close();
    });

    it("refuses a URL whose hostname resolves to a blocked address", async () => {
      resolveAiProviderUrl.mockResolvedValue(false);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/ai/test", payload: { config: validConfig } });

      expect(res.json().success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      await app.close();
    });

    it("reports a transport failure rather than throwing", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/ai/test", payload: { config: validConfig } });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: false, error: "connect ECONNREFUSED" });
      await app.close();
    });

    it("rejects an invalid config without making a request", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/ai/test", payload: { config: { url: "x" } } });

      expect(res.json().success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe("POST /recommendations/ai/refresh", () => {
    it("drops the cached AI recommendations", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/recommendations/ai/refresh" });

      expect(res.json()).toEqual({ refreshed: true });
      expect(trendingCacheDeletePrefix).toHaveBeenCalledWith("ai-recs:");
      await app.close();
    });
  });
});
