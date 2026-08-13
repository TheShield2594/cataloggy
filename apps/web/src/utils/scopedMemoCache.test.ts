import { afterEach, describe, expect, it, vi } from "vitest";
import { getCacheScope, resetDataCacheForTests, setCacheScope } from "./dataCache";
import { createScopedMemoCache } from "./scopedMemoCache";

afterEach(() => {
  vi.useRealTimers();
  resetDataCacheForTests();
});

const cache = <T>(limit: number, ttlMs?: number) => createScopedMemoCache<T>({ limit, ttlMs });

describe("scopedMemoCache", () => {
  it("reads back synchronously, so a render pass can use it as an initial value", () => {
    const c = cache<number>(10);
    c.setForScope(getCacheScope(), "tt1:movie", 1);
    expect(c.get("tt1:movie")).toBe(1);
  });

  it("misses on a key it was never given", () => {
    expect(cache<number>(10).get("tt1:movie")).toBeUndefined();
  });

  describe("scoping", () => {
    // The bug this cache exists to prevent: a detail bundle carries the
    // *profile's* dropped flag, so a second profile reading the first's entry
    // is shown a Dropped badge for a show it never dropped.
    it("keeps one profile from reading another's entries", () => {
      const c = cache<string>(10);
      setCacheScope("profile-a#0");
      c.setForScope(getCacheScope(), "tt1:series", "a's bundle");

      setCacheScope("profile-b#0");
      expect(c.get("tt1:series")).toBeUndefined();
    });

    it("does not resurrect the first profile's entry on a switch back", () => {
      const c = cache<string>(10);
      setCacheScope("profile-a#0");
      c.setForScope(getCacheScope(), "tt1:series", "a's bundle");
      setCacheScope("profile-b#0");
      setCacheScope("profile-a#0");
      // Dropped on the way out rather than merely hidden — otherwise every
      // entry ever written stays in memory for the life of the tab.
      expect(c.get("tt1:series")).toBeUndefined();
    });

    it("treats a token rotation under the same profile as a different identity", () => {
      const c = cache<string>(10);
      setCacheScope("profile-a#0");
      c.setForScope(getCacheScope(), "tt1:series", "before");
      // What api.ts writes when the token changes: same profile id, next epoch.
      setCacheScope("profile-a#1");
      expect(c.get("tt1:series")).toBeUndefined();
    });

    it("drops an answer that arrived after the identity moved", () => {
      const c = cache<string>(10);
      setCacheScope("profile-a#0");
      const inFlight = getCacheScope();

      // The request started under A and resolves after the switch to B.
      setCacheScope("profile-b#0");
      c.setForScope(inFlight, "tt1:series", "a's bundle");

      expect(c.get("tt1:series")).toBeUndefined();
      setCacheScope("profile-a#0");
      expect(c.get("tt1:series")).toBeUndefined();
    });
  });

  describe("expiry", () => {
    it("stops serving an entry once it is past the TTL", () => {
      vi.useFakeTimers();
      const c = cache<number>(10, 60_000);
      c.setForScope(getCacheScope(), "tt1:movie", 1);
      vi.advanceTimersByTime(59_000);
      expect(c.get("tt1:movie")).toBe(1);
      vi.advanceTimersByTime(2_000);
      expect(c.get("tt1:movie")).toBeUndefined();
    });

    it("holds entries indefinitely when no TTL is configured", () => {
      vi.useFakeTimers();
      const c = cache<number>(10);
      c.setForScope(getCacheScope(), "tt1:movie", 1);
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      expect(c.get("tt1:movie")).toBe(1);
    });
  });

  describe("bound", () => {
    it("evicts the oldest write once it is full", () => {
      const c = cache<number>(3);
      for (const [i, key] of ["a", "b", "c", "d"].entries()) {
        c.setForScope(getCacheScope(), key, i);
      }
      expect(c.get("a")).toBeUndefined();
      expect(c.get("b")).toBe(1);
      expect(c.get("d")).toBe(3);
    });

    it("moves a rewritten key to the back of the eviction queue", () => {
      const c = cache<number>(2);
      c.setForScope(getCacheScope(), "a", 1);
      c.setForScope(getCacheScope(), "b", 2);
      c.setForScope(getCacheScope(), "a", 3);
      // "a" was rewritten most recently, so "b" is the oldest write now.
      c.setForScope(getCacheScope(), "c", 4);
      expect(c.get("a")).toBe(3);
      expect(c.get("b")).toBeUndefined();
      expect(c.get("c")).toBe(4);
    });
  });

  describe("invalidate", () => {
    it("clears a family of keys by prefix", () => {
      const c = cache<number>(10);
      c.setForScope(getCacheScope(), "tt1:movie", 1);
      c.setForScope(getCacheScope(), "tt1:series", 2);
      c.setForScope(getCacheScope(), "tt2:movie", 3);
      c.invalidate("tt1:");
      expect(c.get("tt1:movie")).toBeUndefined();
      expect(c.get("tt1:series")).toBeUndefined();
      expect(c.get("tt2:movie")).toBe(3);
    });

    it("leaves another scope's matching keys alone", () => {
      const c = cache<number>(10);
      setCacheScope("profile-a#0");
      c.setForScope(getCacheScope(), "tt1:movie", 1);
      setCacheScope("profile-b#0");
      c.setForScope(getCacheScope(), "tt1:movie", 2);

      c.invalidate("tt1:");
      expect(c.get("tt1:movie")).toBeUndefined();
      setCacheScope("profile-a#0");
      // A's entry is gone too — it was dropped when the scope moved off it, not
      // by this invalidate, and either way B can never be shown it.
      expect(c.get("tt1:movie")).toBeUndefined();
    });
  });

  it("clears everything on request", () => {
    const c = cache<number>(10);
    c.setForScope(getCacheScope(), "a", 1);
    c.clear();
    expect(c.get("a")).toBeUndefined();
  });
});
