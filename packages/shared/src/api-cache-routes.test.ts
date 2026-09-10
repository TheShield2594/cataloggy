import { describe, expect, it } from "vitest";
import {
  API_CACHE_PATH_RE,
  API_CACHE_ROUTES,
  cacheTierForPath,
} from "./api-cache-routes.js";

describe("cacheTierForPath", () => {
  it("puts TMDB-derived facts in the tier the browser may hold", () => {
    expect(cacheTierForPath("/meta/movie/tt0111161")).toBe("metadata");
    expect(cacheTierForPath("/meta/series/tt0903747/cast")).toBe("metadata");
    expect(cacheTierForPath("/meta/series/tt0903747/season/2/episodes")).toBe("metadata");
    expect(cacheTierForPath("/trending")).toBe("metadata");
    expect(cacheTierForPath("/popular")).toBe("metadata");
    expect(cacheTierForPath("/anime")).toBe("metadata");
    expect(cacheTierForPath("/streaming/providers")).toBe("metadata");
  });

  it("puts everything the user owns in the tier that spends a round trip", () => {
    expect(cacheTierForPath("/watchlist")).toBe("revalidate");
    expect(cacheTierForPath("/watch/stats/detailed")).toBe("revalidate");
    expect(cacheTierForPath("/lists/abc/items")).toBe("revalidate");
    expect(cacheTierForPath("/collection")).toBe("revalidate");
    expect(cacheTierForPath("/games/igdb/status")).toBe("revalidate");
    expect(cacheTierForPath("/tags")).toBe("revalidate");
  });

  it("lets a narrow entry win over the prefix it sits under", () => {
    // The ordering of the table is the whole mechanism here: each of these
    // matches a `metadata` prefix too, and would land there if the first
    // matching alternative were not the narrow one.
    expect(cacheTierForPath("/meta/series/tt0903747/bundle")).toBe("revalidate");
    expect(cacheTierForPath("/recommendations/personal")).toBe("revalidate");
    expect(cacheTierForPath("/recommendations/ai")).toBe("revalidate");
    // ...while the bare feed above them stays where it was.
    expect(cacheTierForPath("/recommendations")).toBe("metadata");
  });

  it("keeps `recommendations` exact, so a new sub-route has to choose a tier", () => {
    // Deliberately not `recommendations(/.*)?`: inheriting `metadata` would put
    // a day-long stale-while-revalidate on whatever it turns out to be, in a
    // cache the app cannot reach into to invalidate.
    expect(cacheTierForPath("/recommendations/because-you-watched")).toBeNull();
  });

  it("does not match a route that merely starts with a cacheable name", () => {
    // `/metadata/*` is a maintenance route, not `/meta/*`. The patterns are
    // anchored at both ends precisely so the two cannot be confused.
    expect(cacheTierForPath("/metadata/sync")).toBeNull();
    expect(cacheTierForPath("/metadata/anime-search")).toBeNull();
    expect(cacheTierForPath("/watchlisted")).toBeNull();
  });

  it("leaves anything unlisted uncached", () => {
    expect(cacheTierForPath("/search")).toBeNull();
    expect(cacheTierForPath("/health")).toBeNull();
    expect(cacheTierForPath("/settings/job-status")).toBeNull();
  });

  it("expects the query string to be gone already", () => {
    // Every pattern is anchored at the end, so a caller that forgets to strip
    // the query gets a silent miss rather than a wrong tier. Documented as a
    // test because it is the one way to misuse this.
    expect(cacheTierForPath("/watchlist?sort=added")).toBeNull();
    expect(cacheTierForPath("/watchlist")).toBe("revalidate");
  });
});

describe("API_CACHE_PATH_RE", () => {
  it("answers yes for every route in the table, whatever its tier", () => {
    // The service worker asks only this question, and caches the lot.
    expect(API_CACHE_PATH_RE.test("/meta/movie/tt1/bundle")).toBe(true);
    expect(API_CACHE_PATH_RE.test("/recommendations/personal")).toBe(true);
    expect(API_CACHE_PATH_RE.test("/collection")).toBe(true);
    expect(API_CACHE_PATH_RE.test("/anime")).toBe(true);
    expect(API_CACHE_PATH_RE.test("/search")).toBe(false);
  });

  it("agrees with cacheTierForPath in both directions", () => {
    // The two answers come off the same match, and this is the invariant that
    // says so: nothing may be cacheable without a tier, or tiered without
    // being cacheable. Drift between those was the bug this table replaced.
    for (const path of [
      "/watchlist",
      "/meta/movie/tt1",
      "/meta/movie/tt1/bundle",
      "/recommendations",
      "/recommendations/personal",
      "/games/search",
      "/search",
      "/metadata/sync",
    ]) {
      expect(API_CACHE_PATH_RE.test(path)).toBe(cacheTierForPath(path) !== null);
    }
  });
});

describe("the table itself", () => {
  it("uses only non-capturing groups", () => {
    // `cacheTierForPath` finds the matching route by capture-group index, one
    // group per row. A capturing group inside a pattern would shift every
    // index after it and silently mistier the rest of the table.
    for (const route of API_CACHE_ROUTES) {
      expect(route.pattern.replace(/\(\?[:!=<]/g, ""), route.pattern).not.toContain("(");
    }
  });
});
