import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCacheScope,
  invalidate,
  isFresh,
  readCache,
  resetDataCacheForTests,
  setCacheScope,
  subscribe,
  writeCache,
  writeCacheForScope,
} from "./dataCache";

afterEach(() => resetDataCacheForTests());

describe("dataCache", () => {
  it("reads back synchronously — the whole point, since render can't await", () => {
    writeCache("watchlist", [1, 2, 3]);
    expect(readCache<number[]>("watchlist")).toEqual([1, 2, 3]);
  });

  it("hides an entry once it is past the caller's max age", () => {
    writeCache("stats", { plays: 4 });
    expect(readCache("stats", 10_000)).toEqual({ plays: 4 });
    expect(readCache("stats", -1)).toBeUndefined();
  });

  it("separates freshness from usability", () => {
    writeCache("history", []);
    // Usable and recent: no refetch needed.
    expect(isFresh("history", 10_000)).toBe(true);
    // Usable but past its freshness window: show it, revalidate behind it.
    expect(isFresh("history", -1)).toBe(false);
    expect(readCache("history", 10_000)).toEqual([]);
  });

  it("notifies subscribers so two widgets on one key can't drift apart", () => {
    const listener = vi.fn();
    subscribe("lists", listener);
    writeCache("lists", ["a"]);
    expect(listener).toHaveBeenCalledTimes(1);
    invalidate("lists");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(readCache("lists")).toBeUndefined();
  });

  it("invalidates by prefix, so one write can clear a family of keys", () => {
    writeCache("lists:a", 1);
    writeCache("lists:b", 2);
    writeCache("history", 3);
    invalidate("lists");
    expect(readCache("lists:a")).toBeUndefined();
    expect(readCache("lists:b")).toBeUndefined();
    expect(readCache("history")).toBe(3);
  });

  describe("scoping", () => {
    it("keeps one profile from reading another's entries", () => {
      setCacheScope("profile-a#0");
      writeCache("watchlist", ["a's row"]);

      setCacheScope("profile-b#0");
      expect(readCache("watchlist")).toBeUndefined();
    });

    it("drops a write whose scope is no longer active", () => {
      // A route prefetch captures the scope before it awaits. If the profile
      // changes while that request is in flight, the answer belongs to whoever
      // asked for it — storing it now would show one profile another's data.
      setCacheScope("profile-a#0");
      const captured = getCacheScope();

      setCacheScope("profile-b#0");
      writeCacheForScope(captured, "lists:all", ["a's lists"]);

      expect(readCache("lists:all")).toBeUndefined();
    });

    it("still writes when the scope held throughout", () => {
      setCacheScope("profile-a#0");
      writeCacheForScope(getCacheScope(), "lists:all", ["a's lists"]);
      expect(readCache<string[]>("lists:all")).toEqual(["a's lists"]);
    });

  });
});
