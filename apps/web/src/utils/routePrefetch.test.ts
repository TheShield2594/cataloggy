import { describe, expect, it } from "vitest";
import { EAGER_ROUTES, ROUTE_LOADERS, prefetchRoute } from "./routePrefetch";
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

  it("ignores paths it doesn't know rather than throwing at them", () => {
    // Nav handlers call this on hover for whatever they are given; a route the
    // map has never heard of must cost nothing and break nothing.
    expect(() => prefetchRoute("/not-a-route")).not.toThrow();
    expect(() => prefetchRoute("")).not.toThrow();
  });
});
