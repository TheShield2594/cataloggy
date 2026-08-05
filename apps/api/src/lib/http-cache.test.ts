import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { cacheTierFor, ifNoneMatchSatisfied, registerHttpCaching, weakEtag } from "./http-cache.js";

describe("cacheTierFor", () => {
  it("lets the browser hold TMDB-derived facts, which nothing in the app can change", () => {
    expect(cacheTierFor("/meta/movie/tt0111161")).toBe("metadata");
    expect(cacheTierFor("/meta/series/tt0903747/cast")).toBe("metadata");
    expect(cacheTierFor("/recommendations?type=movie&imdbId=tt0111161")).toBe("metadata");
    expect(cacheTierFor("/trending?type=movie")).toBe("metadata");
  });

  it("makes the user's own data revalidate, since a mutation can't reach the HTTP cache", () => {
    expect(cacheTierFor("/watchlist")).toBe("revalidate");
    expect(cacheTierFor("/watch/history")).toBe("revalidate");
    expect(cacheTierFor("/watch/stats/detailed")).toBe("revalidate");
    expect(cacheTierFor("/lists/abc")).toBe("revalidate");
    expect(cacheTierFor("/calendar?days=14")).toBe("revalidate");
  });

  it("leaves anything it doesn't recognise uncached", () => {
    expect(cacheTierFor("/checkin")).toBeNull();
    expect(cacheTierFor("/settings")).toBeNull();
    expect(cacheTierFor("/search?q=matrix")).toBeNull();
    expect(cacheTierFor("/health")).toBeNull();
  });
});

describe("ifNoneMatchSatisfied", () => {
  const etag = weakEtag("payload");

  it("matches weak against strong, per RFC 9110's weak comparison", () => {
    expect(ifNoneMatchSatisfied(etag, etag)).toBe(true);
    expect(ifNoneMatchSatisfied(etag.replace(/^W\//, ""), etag)).toBe(true);
  });

  it("matches one entry out of a list, and the wildcard", () => {
    expect(ifNoneMatchSatisfied(`W/"other", ${etag}`, etag)).toBe(true);
    expect(ifNoneMatchSatisfied("*", etag)).toBe(true);
  });

  it("does not match a different tag or an absent header", () => {
    expect(ifNoneMatchSatisfied('W/"nope"', etag)).toBe(false);
    expect(ifNoneMatchSatisfied(undefined, etag)).toBe(false);
  });
});

describe("conditional responses", () => {
  const buildApp = () => {
    const app = Fastify();
    registerHttpCaching(app);
    app.get("/watch/history", async () => [{ id: "1", name: "Heat" }]);
    app.get("/meta/movie/tt1", async () => ({ imdbId: "tt1" }));
    app.get("/checkin", async () => ({ checkin: null }));
    app.post("/watchlist", async () => ({ ok: true }));
    return app;
  };

  it("answers an unchanged repeat with a bodyless 304", async () => {
    const app = buildApp();
    const first = await app.inject({ method: "GET", url: "/watch/history" });
    expect(first.statusCode).toBe(200);
    expect(first.headers.etag).toBeTruthy();
    expect(first.headers["cache-control"]).toBe("private, no-cache");

    const second = await app.inject({
      method: "GET",
      url: "/watch/history",
      headers: { "if-none-match": String(first.headers.etag) },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });

  it("varies on the caller, so one profile's entry can't answer another's request", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/watch/history" });
    expect(response.headers.vary).toBe("Authorization, X-Profile-Id");
  });

  it("gives metadata a max-age but never marks it public", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/meta/movie/tt1" });
    const cacheControl = String(response.headers["cache-control"]);
    expect(cacheControl).toContain("private");
    expect(cacheControl).toContain("max-age=300");
    expect(cacheControl).not.toContain("public");
  });

  it("leaves unlisted routes and non-GET requests alone", async () => {
    const app = buildApp();
    const unlisted = await app.inject({ method: "GET", url: "/checkin" });
    expect(unlisted.headers["cache-control"]).toBeUndefined();
    expect(unlisted.headers.etag).toBeUndefined();

    const mutation = await app.inject({ method: "POST", url: "/watchlist" });
    expect(mutation.headers["cache-control"]).toBeUndefined();
    expect(mutation.headers.etag).toBeUndefined();
  });
});
