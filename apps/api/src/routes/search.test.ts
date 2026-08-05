import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const prismaMock = { listItem: { findMany: vi.fn() } };

const search = vi.fn();
const searchMulti = vi.fn();
const getTmdb = vi.fn();
const upsertMetadata = vi.fn();
const getRpdbApiKey = vi.fn();

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/tmdb-client.js", () => ({ getTmdb: () => getTmdb() }));
vi.mock("../lib/metadata.js", () => ({ upsertMetadata: (...a: unknown[]) => upsertMetadata(...a) }));
vi.mock("../lib/rpdb.js", () => ({
  getRpdbApiKey: () => getRpdbApiKey(),
  withRpdbPoster: (imdbId: string, poster: string | null, key: string | null) =>
    key ? `https://api.ratingposterdb.com/${key}/imdb/poster-default/${imdbId}.jpg` : poster,
}));
vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const buildApp = (): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./search.js"));

const result = (over: Record<string, unknown> = {}) => ({
  imdbId: "tt0111161",
  type: "movie",
  name: "The Shawshank Redemption",
  year: 1994,
  poster: "https://image.tmdb.org/poster.jpg",
  description: "Two imprisoned men bond.",
  genres: ["Drama"],
  rating: 8.7,
  ...over,
});

describe("search routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTmdb.mockResolvedValue({ search, searchMulti });
    search.mockResolvedValue([result()]);
    searchMulti.mockResolvedValue([result()]);
    upsertMetadata.mockResolvedValue(undefined);
    getRpdbApiKey.mockResolvedValue(null);
    prismaMock.listItem.findMany.mockResolvedValue([]);
  });

  it("searches a single type when one is given", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?type=movie&q=shawshank" });

    expect(res.statusCode).toBe(200);
    expect(search).toHaveBeenCalledWith("movie", "shawshank");
    expect(searchMulti).not.toHaveBeenCalled();
  });

  it("defaults to a multi-search across movies and series", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?q=shawshank" });

    expect(res.statusCode).toBe(200);
    expect(searchMulti).toHaveBeenCalledWith("shawshank");
  });

  it("accepts `query` as an alias for `q`", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?query=shawshank" });

    expect(res.statusCode).toBe(200);
    expect(searchMulti).toHaveBeenCalledWith("shawshank");
  });

  it("rejects a blank query", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?q=%20%20" });

    expect(res.statusCode).toBe(400);
    expect(getTmdb).not.toHaveBeenCalled();
  });

  it("rejects a type that is neither movie, series nor all", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?type=book&q=x" });

    expect(res.statusCode).toBe(400);
  });

  it("returns 500 when TMDB is not configured", async () => {
    getTmdb.mockRejectedValue(new Error("no api key"));
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?q=x" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/not configured/i);
  });

  it("returns 502 when the TMDB search itself fails", async () => {
    // Distinct from the 500 above: the integration is configured, the upstream
    // is the thing that broke.
    searchMulti.mockRejectedValue(new Error("upstream 503"));
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?q=x" });

    expect(res.statusCode).toBe(502);
  });

  it("caps the result set at 20", async () => {
    searchMulti.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => result({ imdbId: `tt${i}` }))
    );
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?q=x" });

    expect(res.json()).toHaveLength(20);
  });

  it("flags results already on the watchlist or in the collection", async () => {
    prismaMock.listItem.findMany.mockResolvedValue([
      { imdbId: "tt0111161", type: "movie", list: { id: "l1", name: "Watchlist", kind: "watchlist" } },
      { imdbId: "tt0111161", type: "movie", list: { id: "l2", name: "Collection", kind: "collection" } },
    ]);
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?q=x" });

    expect(res.json()[0]).toMatchObject({ inWatchlist: true, inCollection: true, lists: ["l1", "l2"] });
  });

  it("does not flag a movie because the series with that imdbId is listed", async () => {
    // The list lookup keys on imdbId *and* type.
    prismaMock.listItem.findMany.mockResolvedValue([
      { imdbId: "tt0111161", type: "series", list: { id: "l1", name: "Watchlist", kind: "watchlist" } },
    ]);
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?q=x" });

    expect(res.json()[0]).toMatchObject({ inWatchlist: false, lists: [] });
  });

  it("only considers lists belonging to the calling profile", async () => {
    const app = await buildApp();

    await app.inject({ method: "GET", url: "/search?q=x" });

    expect(prismaMock.listItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ list: { profileId: PROFILE_ID } }),
      })
    );
  });

  it("swaps in an RPDB poster when a key is configured", async () => {
    getRpdbApiKey.mockResolvedValue("rpdb-key");
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?q=x" });

    expect(res.json()[0].poster).toContain("ratingposterdb.com");
  });

  it("still returns results when caching a result's metadata fails", async () => {
    // upsertMetadata runs under allSettled — a write failure is not the
    // user's search failing.
    upsertMetadata.mockRejectedValue(new Error("db write failed"));
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/search?q=x" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});
