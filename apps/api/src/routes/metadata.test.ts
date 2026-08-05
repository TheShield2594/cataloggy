import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const prismaMock = {
  kV: { findUnique: vi.fn() },
  metadata: { findMany: vi.fn() },
};

const loadMeta = vi.fn();
const loadCast = vi.fn();
const loadSeasons = vi.fn();
const loadEpisodes = vi.fn();
const loadProviders = vi.fn();
const loadRecommendations = vi.fn();
const syncMetadata = vi.fn();
const upsertMetadata = vi.fn();
const searchAnime = vi.fn();
const getTmdb = vi.fn();
const findByImdbId = vi.fn();
const getOmdbApiKey = vi.fn();

const EMPTY_PROVIDERS = { flatrate: [], rent: [], buy: [] };

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/detail.js", () => ({
  EMPTY_PROVIDERS,
  loadMeta: (...a: unknown[]) => loadMeta(...a),
  loadCast: (...a: unknown[]) => loadCast(...a),
  loadSeasons: (...a: unknown[]) => loadSeasons(...a),
  loadEpisodes: (...a: unknown[]) => loadEpisodes(...a),
  loadProviders: (...a: unknown[]) => loadProviders(...a),
}));
vi.mock("../lib/recommendations.js", () => ({
  loadRecommendations: (...a: unknown[]) => loadRecommendations(...a),
}));
vi.mock("../lib/metadata.js", () => ({
  syncMetadata: (...a: unknown[]) => syncMetadata(...a),
  upsertMetadata: (...a: unknown[]) => upsertMetadata(...a),
}));
vi.mock("../lib/anilist-client.js", () => ({ searchAnime: (...a: unknown[]) => searchAnime(...a) }));
vi.mock("../lib/tmdb-client.js", () => ({ getTmdb: () => getTmdb() }));
vi.mock("../lib/omdb.js", () => ({
  getOmdbApiKey: () => getOmdbApiKey(),
  fetchOmdbRatings: vi.fn().mockResolvedValue(null),
  upsertOmdbRatings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/dropped-shows.js", () => ({
  droppedSeriesKey: (profileId: string, imdbId: string) => `dropped:${profileId}:${imdbId}`,
}));
vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: metadataRoutes } = await import("./metadata.js");
  const app = Fastify({ logger: false });
  await app.register(metadataRoutes);
  await app.ready();
  return app;
};

describe("metadata routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMeta.mockResolvedValue({ id: "tt1", name: "A Title" });
    loadCast.mockResolvedValue({ cast: [{ name: "An Actor" }], director: "A Director" });
    loadSeasons.mockResolvedValue([{ season: 1 }]);
    loadEpisodes.mockResolvedValue([{ episode: 1 }]);
    loadProviders.mockResolvedValue({ flatrate: [{ name: "Netflix" }], rent: [], buy: [] });
    loadRecommendations.mockResolvedValue({ metas: [{ id: "tt2" }] });
    prismaMock.kV.findUnique.mockResolvedValue(null);
    prismaMock.metadata.findMany.mockResolvedValue([]);
    getTmdb.mockResolvedValue({ findByImdbId });
    getOmdbApiKey.mockResolvedValue(null);
  });

  describe("GET /meta/:type/:imdbId", () => {
    it("returns the metadata for a known title", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/movie/tt1" });

      expect(res.statusCode).toBe(200);
      expect(loadMeta).toHaveBeenCalledWith("movie", "tt1");
      await app.close();
    });

    it("rejects a type that is not movie or series", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/episode/tt1" });

      expect(res.statusCode).toBe(400);
      expect(loadMeta).not.toHaveBeenCalled();
      await app.close();
    });

    it("404s when nothing is found", async () => {
      loadMeta.mockResolvedValue(null);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/movie/tt1" });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it("returns 500 when the lookup throws", async () => {
      loadMeta.mockRejectedValue(new Error("upstream"));
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/movie/tt1" });

      expect(res.statusCode).toBe(500);
      await app.close();
    });
  });

  describe("GET /meta/series/:imdbId/season/:seasonNumber/episodes", () => {
    it("loads a season's episodes", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/series/tt1/season/2/episodes" });

      expect(res.statusCode).toBe(200);
      expect(loadEpisodes).toHaveBeenCalledWith("tt1", 2, expect.anything());
      await app.close();
    });

    it("rejects season 0 and other non-positive season numbers", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/series/tt1/season/0/episodes" });

      expect(res.statusCode).toBe(400);
      expect(loadEpisodes).not.toHaveBeenCalled();
      await app.close();
    });

    it("rejects a non-numeric season", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/series/tt1/season/two/episodes" });

      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("GET /meta/:type/:imdbId/providers", () => {
    it("degrades to an empty provider set for an unknown type", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/book/tt1/providers" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ providers: EMPTY_PROVIDERS });
      await app.close();
    });
  });

  describe("GET /meta/:type/:imdbId/bundle", () => {
    it("returns every section of the detail panel in one response", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/series/tt1/bundle" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.meta).toMatchObject({ name: "A Title" });
      expect(body.cast).toHaveLength(1);
      expect(body.director).toBe("A Director");
      expect(body.recommendations).toHaveLength(1);
      expect(body.seasons).toHaveLength(1);
      await app.close();
    });

    it("skips the seasons and dropped lookups for a movie", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/movie/tt1/bundle" });

      expect(res.json()).toMatchObject({ seasons: [], dropped: false });
      expect(loadSeasons).not.toHaveBeenCalled();
      expect(prismaMock.kV.findUnique).not.toHaveBeenCalled();
      await app.close();
    });

    it("reports a series the profile has dropped", async () => {
      prismaMock.kV.findUnique.mockResolvedValue({ key: `dropped:${PROFILE_ID}:tt1`, value: "1" });
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/series/tt1/bundle" });

      expect(res.json().dropped).toBe(true);
      await app.close();
    });

    it("still renders the panel when an optional section fails", async () => {
      // Each section degrades on its own; one failing upstream must not take
      // the whole panel down.
      loadCast.mockRejectedValue(new Error("tmdb down"));
      loadProviders.mockRejectedValue(new Error("tmdb down"));
      loadRecommendations.mockRejectedValue(new Error("tmdb down"));
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/movie/tt1/bundle" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ cast: [], director: null, providers: EMPTY_PROVIDERS, recommendations: [] });
      await app.close();
    });

    it("404s when the title itself is missing", async () => {
      loadMeta.mockResolvedValue(null);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/meta/movie/tt1/bundle" });

      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });

  describe("POST /metadata/sync", () => {
    it("syncs a title from TMDB", async () => {
      syncMetadata.mockResolvedValue({ imdbId: "tt1", name: "A Title" });
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/metadata/sync",
        payload: { imdbId: " tt1 ", type: "movie" },
      });

      expect(res.statusCode).toBe(200);
      expect(syncMetadata).toHaveBeenCalledWith("tt1", "movie");
      await app.close();
    });

    it("404s when TMDB has no record of the title", async () => {
      syncMetadata.mockResolvedValue(null);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/metadata/sync",
        payload: { imdbId: "tt1", type: "movie" },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it("requires a type", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/metadata/sync", payload: { imdbId: "tt1" } });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("requires an imdbId", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/metadata/sync", payload: { type: "movie" } });

      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("POST /metadata/refresh-all", () => {
    it("short-circuits when there is nothing stored", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/metadata/refresh-all" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ refreshed: 0, total: 0, limit: 50 });
      expect(getTmdb).not.toHaveBeenCalled();
      await app.close();
    });

    it("caps the limit at 500", async () => {
      const app = await buildApp();

      await app.inject({ method: "POST", url: "/metadata/refresh-all?limit=100000" });

      expect(prismaMock.metadata.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
      await app.close();
    });

    it("falls back to 50 for a non-numeric limit", async () => {
      const app = await buildApp();

      await app.inject({ method: "POST", url: "/metadata/refresh-all?limit=lots" });

      expect(prismaMock.metadata.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
      await app.close();
    });

    it("counts only the rows TMDB actually returned", async () => {
      prismaMock.metadata.findMany.mockResolvedValue([
        { imdbId: "tt1", type: "movie" },
        { imdbId: "tt2", type: "movie" },
      ]);
      findByImdbId.mockResolvedValueOnce({ imdbId: "tt1" }).mockResolvedValueOnce(null);
      upsertMetadata.mockResolvedValue(undefined);
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/metadata/refresh-all" });

      expect(res.json()).toMatchObject({ refreshed: 1, total: 2 });
      await app.close();
    });

    it("keeps going when one title's refresh throws", async () => {
      prismaMock.metadata.findMany.mockResolvedValue([
        { imdbId: "tt1", type: "movie" },
        { imdbId: "tt2", type: "movie" },
      ]);
      findByImdbId.mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce({ imdbId: "tt2" });
      upsertMetadata.mockResolvedValue(undefined);
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/metadata/refresh-all" });

      expect(res.statusCode).toBe(200);
      expect(res.json().refreshed).toBe(1);
      await app.close();
    });

    it("returns 500 when TMDB cannot be initialised", async () => {
      prismaMock.metadata.findMany.mockResolvedValue([{ imdbId: "tt1", type: "movie" }]);
      getTmdb.mockRejectedValue(new Error("no key"));
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/metadata/refresh-all" });

      expect(res.statusCode).toBe(500);
      await app.close();
    });
  });

  describe("GET /metadata/anime-search", () => {
    it("returns AniList results", async () => {
      searchAnime.mockResolvedValue([{ id: 1, title: "Cowboy Bebop" }]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/metadata/anime-search?q=bebop" });

      expect(res.statusCode).toBe(200);
      expect(res.json().results).toHaveLength(1);
      await app.close();
    });

    it("requires a query", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/metadata/anime-search" });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("returns 502 when AniList fails", async () => {
      searchAnime.mockRejectedValue(new Error("down"));
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/metadata/anime-search?q=bebop" });

      expect(res.statusCode).toBe(502);
      await app.close();
    });
  });

  describe("GET /genres", () => {
    it("returns a sorted, de-duplicated genre list", async () => {
      prismaMock.metadata.findMany.mockResolvedValue([
        { genres: ["Drama", "Crime"] },
        { genres: ["Crime", "Action"] },
      ]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/genres" });

      expect(res.json().genres).toEqual(["Action", "Crime", "Drama"]);
      await app.close();
    });
  });
});
