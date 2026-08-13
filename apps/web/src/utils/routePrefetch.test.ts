import { afterEach, describe, expect, it, vi } from "vitest";
import { EAGER_ROUTES, ROUTE_LOADERS, prefetchRoute, resetPrefetchStateForTests } from "./routePrefetch";
import { readCache, resetDataCacheForTests } from "./dataCache";
import { PAGE_SIZE } from "../pages/HistoryPage";
import { MORE_NAV_ITEMS, PRIMARY_NAV_ITEMS } from "../components/MobileTabBar";
import { SIDEBAR_NAV_ITEMS } from "../components/Sidebar";

// A nav item with no loader still navigates — it just pays for its chunk on the
// click instead of on the approach, silently, which is the delay this module
// exists to remove. Adding a destination has to mean adding a loader, so pin it.
//
// The exception is a route already in the entry bundle: there is no chunk to
// warm, so it declares itself eager instead of carrying a loader that would
// only make the build warn about a mixed static/dynamic import.
const isCovered = (to: string) => EAGER_ROUTES.has(to) || typeof ROUTE_LOADERS[to] === "function";

// Prefetch state is process-wide, and a stubbed `api` would otherwise be the
// one the next file's dynamic import resolves to.
afterEach(() => {
  vi.doUnmock("../api");
  resetPrefetchStateForTests();
  resetDataCacheForTests();
});

describe("route prefetch coverage", () => {
  it("has a loader for every sidebar destination", () => {
    for (const item of SIDEBAR_NAV_ITEMS) {
      expect(isCovered(item.to), `no prefetch loader for ${item.to}`).toBe(true);
    }
  });

  it("has a loader for every mobile tab destination, including the ones behind More", () => {
    for (const item of [...PRIMARY_NAV_ITEMS, ...MORE_NAV_ITEMS]) {
      expect(isCovered(item.to), `no prefetch loader for ${item.to}`).toBe(true);
    }
  });

  /*
   * A warmer is only worth running if the page reads what it wrote. History is
   * keyed by its filter (`history:events:<filter>`) because a filtered page is
   * a different answer; the warmer fetches unfiltered, so `:all` — under the
   * bare `history:events` it wrote a key nobody reads, and under a filtered one
   * it would seed the wrong list.
   */
  it("warms the history page under the key its unfiltered view reads", async () => {
    resetDataCacheForTests();
    resetPrefetchStateForTests();
    const events = [{ id: "ev-1", imdbId: "tt1", type: "movie", name: "Alien" }];
    vi.doMock("../api", () => ({ api: { getWatchHistory: async () => events } }));

    prefetchRoute("/history");
    await vi.waitFor(() => expect(readCache("history:events:all")).toEqual(events));
  });

  // The page counts the offset of its next request from the rows it is holding,
  // so a warm-up of any other size seeds a first page no request would have
  // returned — and one that visibly resizes when the page's own load lands.
  it("warms exactly the page of history the page itself would ask for", async () => {
    resetDataCacheForTests();
    resetPrefetchStateForTests();
    const getWatchHistory = vi.fn(async () => []);
    vi.doMock("../api", () => ({ api: { getWatchHistory } }));

    prefetchRoute("/history");

    await vi.waitFor(() => expect(getWatchHistory).toHaveBeenCalledWith(PAGE_SIZE));
  });

  it("ignores paths it doesn't know rather than throwing at them", () => {
    // Nav handlers call this on hover for whatever they are given; a route the
    // map has never heard of must cost nothing and break nothing.
    expect(() => prefetchRoute("/not-a-route")).not.toThrow();
    expect(() => prefetchRoute("")).not.toThrow();
  });
});
