import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const discoverByProvider = vi.fn();
const discoverAnime = vi.fn();
const getTmdb = vi.fn();
const getRegionSetting = vi.fn();
const upsertMetadata = vi.fn();
const getRpdbApiKey = vi.fn();
const trendingCacheGet = vi.fn();
const trendingCacheSet = vi.fn();

vi.mock("../lib/tmdb-client.js", () => ({ getTmdb: () => getTmdb() }));
vi.mock("../lib/settings.js", () => ({ getRegionSetting: () => getRegionSetting() }));
vi.mock("../lib/metadata.js", () => ({ upsertMetadata: (...a: unknown[]) => upsertMetadata(...a) }));
vi.mock("../lib/rpdb.js", () => ({
  getRpdbApiKey: () => getRpdbApiKey(),
  applyRpdbToMetaList: (metas: unknown[], key: string | null) =>
    key ? metas.map((m) => ({ ...(m as object), poster: "rpdb" })) : metas,
}));
vi.mock("../lib/cache.js", () => ({
  trendingCacheGet: (...a: unknown[]) => trendingCacheGet(...a),
  trendingCacheSet: (...a: unknown[]) => trendingCacheSet(...a),
}));

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: streamingRoutes } = await import("./streaming.js");
  const app = Fastify();
  await app.register(streamingRoutes);
  await app.ready();
  return app;
};

const payload = (over: Record<string, unknown> = {}) => ({
  imdbId: "tt1",
  name: "A Title",
  poster: "https://image.tmdb.org/p.jpg",
  year: 2020,
  description: "desc",
  genres: ["Drama"],
  rating: 7,
  ...over,
});

describe("streaming routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTmdb.mockResolvedValue({ discoverByProvider, discoverAnime });
    discoverByProvider.mockResolvedValue([payload()]);
    discoverAnime.mockResolvedValue([payload()]);
    getRegionSetting.mockResolvedValue("US");
    upsertMetadata.mockResolvedValue(undefined);
    getRpdbApiKey.mockResolvedValue(null);
    trendingCacheGet.mockReturnValue(undefined);
  });

  describe("GET /streaming", () => {
    it("discovers titles for a known provider", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/streaming?provider=netflix&type=movie" });

      expect(res.statusCode).toBe(200);
      expect(discoverByProvider).toHaveBeenCalledWith("movie", 8, "US");
      expect(res.json()).toMatchObject({ provider: "Netflix" });
      await app.close();
    });

    it("matches a provider key case-insensitively", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/streaming?provider=NETFLIX" });

      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("lists the available providers when none is given", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/streaming?type=movie" });

      expect(res.statusCode).toBe(400);
      expect(res.json().available).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: "netflix" })])
      );
      await app.close();
    });

    it("rejects an unknown provider", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/streaming?provider=nowtv" });

      expect(res.statusCode).toBe(400);
      expect(discoverByProvider).not.toHaveBeenCalled();
      await app.close();
    });

    it("rejects a type that is not movie or series", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/streaming?provider=netflix&type=episode" });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("prefers an explicit region over the stored setting", async () => {
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/streaming?provider=netflix&region=GB" });

      expect(discoverByProvider).toHaveBeenCalledWith("movie", 8, "GB");
      expect(getRegionSetting).not.toHaveBeenCalled();
      await app.close();
    });

    it("keys the cache by provider, type and region", async () => {
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/streaming?provider=netflix&type=series&region=GB" });

      expect(trendingCacheSet).toHaveBeenCalledWith("streaming:netflix:series:GB", expect.anything());
      await app.close();
    });

    it("serves a cache hit without calling TMDB", async () => {
      trendingCacheGet.mockReturnValue({ data: [{ id: "tt9", type: "movie", name: "Cached" }] });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/streaming?provider=netflix" });

      expect(res.statusCode).toBe(200);
      expect(res.json().metas[0].name).toBe("Cached");
      expect(getTmdb).not.toHaveBeenCalled();
      await app.close();
    });

    it("applies RPDB posters to a cached response too", async () => {
      trendingCacheGet.mockReturnValue({ data: [{ id: "tt9", type: "movie", name: "Cached" }] });
      getRpdbApiKey.mockResolvedValue("rpdb-key");
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/streaming?provider=netflix" });

      expect(res.json().metas[0].poster).toBe("rpdb");
      await app.close();
    });

    it("returns 500 when the discover call fails", async () => {
      discoverByProvider.mockRejectedValue(new Error("upstream"));
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/streaming?provider=netflix" });

      expect(res.statusCode).toBe(500);
      expect(trendingCacheSet).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe("GET /streaming/providers", () => {
    it("returns the provider catalogue", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/streaming/providers" });

      expect(res.statusCode).toBe(200);
      expect(res.json().providers).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: "crunchyroll", name: "Crunchyroll" })])
      );
      await app.close();
    });
  });

  describe("GET /anime", () => {
    it("defaults to series", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/anime" });

      expect(res.statusCode).toBe(200);
      expect(discoverAnime).toHaveBeenCalledWith("series");
      expect(trendingCacheSet).toHaveBeenCalledWith("anime:series", expect.anything());
      await app.close();
    });

    it("supports anime films", async () => {
      const app = await buildApp();

      await app.inject({ method: "GET", url: "/anime?type=movie" });

      expect(discoverAnime).toHaveBeenCalledWith("movie");
      await app.close();
    });

    it("rejects an unsupported type", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/anime?type=episode" });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("returns 500 when the anime discover call fails", async () => {
      discoverAnime.mockRejectedValue(new Error("upstream"));
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/anime" });

      expect(res.statusCode).toBe(500);
      await app.close();
    });
  });
});
