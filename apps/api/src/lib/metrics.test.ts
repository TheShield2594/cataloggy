import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  metricsSnapshot,
  recordRequest,
  recordUpstreamCall,
  resetMetrics,
  statusClassOf,
} from "./metrics.js";

describe("metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("request counters", () => {
    it("totals requests and buckets them by status class", () => {
      recordRequest({ method: "GET", route: "/watchlist", statusCode: 200, durationMs: 5 });
      recordRequest({ method: "GET", route: "/watchlist", statusCode: 304, durationMs: 1 });
      recordRequest({ method: "GET", route: "/watchlist", statusCode: 401, durationMs: 1 });
      recordRequest({ method: "GET", route: "/watchlist", statusCode: 500, durationMs: 9 });

      const { requests } = metricsSnapshot();

      expect(requests.total).toBe(4);
      expect(requests.byStatusClass).toEqual({ "2xx": 1, "3xx": 1, "4xx": 1, "5xx": 1, other: 0 });
    });

    it("counts only 5xx as a failure", () => {
      // A 401 from a wrong token or a 404 for a deleted title is the API
      // working. Counting those would leave the failure count permanently
      // non-zero on a healthy install, which is the same as having no signal.
      recordRequest({ method: "GET", route: "/watchlist", statusCode: 404, durationMs: 1 });
      recordRequest({ method: "GET", route: "/watchlist", statusCode: 503, durationMs: 1 });

      expect(metricsSnapshot().requests.routes[0]).toMatchObject({ count: 2, failures: 1 });
    });

    it("keys on method and route so the same path by two verbs stays apart", () => {
      recordRequest({ method: "GET", route: "/lists/:id", statusCode: 200, durationMs: 1 });
      recordRequest({ method: "DELETE", route: "/lists/:id", statusCode: 200, durationMs: 1 });

      expect(metricsSnapshot().requests.routes.map((r) => r.route).sort()).toEqual([
        "DELETE /lists/:id",
        "GET /lists/:id",
      ]);
    });

    it("summarises duration as total, max and average", () => {
      recordRequest({ method: "GET", route: "/search", statusCode: 200, durationMs: 10 });
      recordRequest({ method: "GET", route: "/search", statusCode: 200, durationMs: 30 });

      expect(metricsSnapshot().requests.routes[0]).toMatchObject({
        totalDurationMs: 40,
        maxDurationMs: 30,
        avgDurationMs: 20,
      });
    });

    it("lists the busiest routes first", () => {
      recordRequest({ method: "GET", route: "/quiet", statusCode: 200, durationMs: 1 });
      recordRequest({ method: "GET", route: "/busy", statusCode: 200, durationMs: 1 });
      recordRequest({ method: "GET", route: "/busy", statusCode: 200, durationMs: 1 });

      expect(metricsSnapshot().requests.routes[0].route).toBe("GET /busy");
    });

    it("folds requests that matched no route into one bucket", () => {
      // Otherwise a scanner walking /wp-admin, /.env, /phpmyadmin… writes one
      // counter per path it guesses.
      recordRequest({ method: "GET", route: undefined, statusCode: 404, durationMs: 1 });
      recordRequest({ method: "GET", route: undefined, statusCode: 404, durationMs: 1 });

      expect(metricsSnapshot().requests.routes).toEqual([
        expect.objectContaining({ route: "GET (unmatched)", count: 2 }),
      ]);
    });

    it("stops growing once it is tracking too many routes", () => {
      for (let i = 0; i < 250; i += 1) {
        recordRequest({ method: "GET", route: `/route-${i}`, statusCode: 200, durationMs: 1 });
      }

      const { requests } = metricsSnapshot();

      expect(requests.total).toBe(250);
      expect(requests.routes.length).toBeLessThanOrEqual(201);
      expect(requests.routes).toContainEqual(expect.objectContaining({ route: "other", count: 50 }));
    });
  });

  describe("upstream counters", () => {
    it("tallies calls per host, counting a non-2xx answer as a failure", () => {
      recordUpstreamCall("api.themoviedb.org", 40, true);
      recordUpstreamCall("api.themoviedb.org", 60, false);
      recordUpstreamCall("api.trakt.tv", 10, true);

      expect(metricsSnapshot().upstream).toEqual([
        expect.objectContaining({ host: "api.themoviedb.org", count: 2, failures: 1, avgDurationMs: 50 }),
        expect.objectContaining({ host: "api.trakt.tv", count: 1, failures: 0 }),
      ]);
    });

    it("stops growing once it is tracking too many hosts", () => {
      for (let i = 0; i < 60; i += 1) recordUpstreamCall(`host-${i}.example`, 1, true);

      expect(metricsSnapshot().upstream.length).toBeLessThanOrEqual(51);
      expect(metricsSnapshot().upstream).toContainEqual(expect.objectContaining({ host: "other", count: 10 }));
    });
  });

  describe("statusClassOf", () => {
    it("buckets by hundreds and files anything unrecognised under other", () => {
      expect(statusClassOf(204)).toBe("2xx");
      expect(statusClassOf(499)).toBe("4xx");
      expect(statusClassOf(599)).toBe("5xx");
      expect(statusClassOf(101)).toBe("other");
      expect(statusClassOf(0)).toBe("other");
    });
  });

  describe("instrumentUpstreamFetch", () => {
    const realFetch = globalThis.fetch;

    // Installing is once-per-process by design, so each test needs its own
    // module instance to install into — and its own counters with it.
    const freshMetrics = async () => {
      vi.resetModules();
      return import("./metrics.js");
    };

    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    it("times a call and records it against the hostname only", async () => {
      // Never the full URL: TMDB, OMDb and RPDB all take their key as a query
      // parameter, and a counter map is the last place a credential belongs.
      const metrics = await freshMetrics();
      globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      metrics.instrumentUpstreamFetch();

      await fetch("https://api.themoviedb.org/3/movie/550?api_key=secret-key");

      const [upstream] = metrics.metricsSnapshot().upstream;
      expect(upstream).toMatchObject({ host: "api.themoviedb.org", count: 1, failures: 0 });
      expect(JSON.stringify(upstream)).not.toContain("secret-key");
    });

    it("records a thrown call as a failure and rethrows it", async () => {
      const metrics = await freshMetrics();
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      metrics.instrumentUpstreamFetch();

      await expect(fetch("https://api.trakt.tv/sync/history")).rejects.toThrow("ECONNREFUSED");

      expect(metrics.metricsSnapshot().upstream).toEqual([
        expect.objectContaining({ host: "api.trakt.tv", count: 1, failures: 1 }),
      ]);
    });

    it("counts an upstream error response as a failed call", async () => {
      const metrics = await freshMetrics();
      globalThis.fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
      metrics.instrumentUpstreamFetch();

      await fetch("https://api.themoviedb.org/3/movie/550");

      expect(metrics.metricsSnapshot().upstream).toEqual([
        expect.objectContaining({ host: "api.themoviedb.org", count: 1, failures: 1 }),
      ]);
    });

    it("installs itself once, however many times it is called", async () => {
      const metrics = await freshMetrics();
      const underlying = vi.fn().mockResolvedValue(new Response("{}"));
      globalThis.fetch = underlying;
      metrics.instrumentUpstreamFetch();
      metrics.instrumentUpstreamFetch();

      await fetch("https://api.strem.io/api/datastoreMeta");

      // A second wrap would double-count every call for the rest of the run.
      expect(metrics.metricsSnapshot().upstream).toEqual([
        expect.objectContaining({ host: "api.strem.io", count: 1 }),
      ]);
      expect(underlying).toHaveBeenCalledTimes(1);
    });
  });
});
