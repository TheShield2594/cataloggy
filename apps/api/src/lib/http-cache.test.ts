import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import compress from "@fastify/compress";
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

// The two hooks are registered in a specific order in index.ts — caching first,
// so the ETag is computed over JSON rather than over whichever encoding the
// client negotiated. That ordering is load-bearing, and it puts a compression
// hook downstream of a 304 that returns no payload at all. This pins both ends
// of that interaction.
describe("alongside compression", () => {
  const build = async () => {
    const app = Fastify();
    registerHttpCaching(app);
    await app.register(compress, {
      global: true,
      threshold: 1024,
      encodings: ["br", "gzip", "deflate"],
    });
    app.get("/watch/history", async () =>
      Array.from({ length: 200 }, (_, i) => ({ id: String(i), name: "A long enough title" }))
    );
    return app;
  };

  it("still compresses a full response", async () => {
    const app = await build();
    const response = await app.inject({
      method: "GET",
      url: "/watch/history",
      headers: { "accept-encoding": "gzip" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
  });

  it("sends a 304 with no body and no content-encoding", async () => {
    const app = await build();
    const first = await app.inject({
      method: "GET",
      url: "/watch/history",
      headers: { "accept-encoding": "gzip" },
    });

    const second = await app.inject({
      method: "GET",
      url: "/watch/history",
      headers: { "accept-encoding": "gzip", "if-none-match": String(first.headers.etag) },
    });

    expect(second.statusCode).toBe(304);
    expect(second.rawPayload.length).toBe(0);
    // A Content-Encoding on an empty body is what a client would try to inflate.
    expect(second.headers["content-encoding"]).toBeUndefined();
  });
});
