// A module-level memo cache that a component can read synchronously, for the
// answers that are too narrow to belong in `dataCache` — one entry per title
// visited rather than one per page.
//
// Written because two of these grew by hand and both got the same two things
// wrong. They were keyed on the title alone, so an entry written under one
// profile was readable by the next; and they were plain `Map`s with no bound,
// so a long session accumulated an entry per title browsed for the lifetime of
// the tab. Both are fixed here once:
//
//   * every key carries the active cache scope, the same identity `dataCache`
//     partitions on — so a profile switch or a token rotation makes the
//     previous entries unreachable rather than merely stale, and
//     `subscribeScope` then drops them instead of leaking them;
//   * entries are capped, evicting oldest-written first.
//
// Reads are pure apart from dropping an entry that has already expired, so a
// render pass may call `get` directly.

import { getCacheScope, subscribeScope } from "./dataCache";

type Entry<T> = { at: number; value: T };

export type ScopedMemoCache<T> = {
  /** The value stored under `key` for the active scope, if it is still fresh. */
  get(key: string): T | undefined;
  /**
   * Stores `value` only if `expectedScope` is still the active scope.
   *
   * Every caller here fetches, awaits, and writes what comes back. A profile
   * switch in between means the answer belongs to an identity that is no
   * longer active, and storing it under the new scope would hand one profile
   * another's data — so callers capture `getCacheScope()` before the await and
   * pass it back. Mirrors `writeCacheForScope` in `dataCache`.
   */
  setForScope(expectedScope: string, key: string, value: T): void;
  /** Drops every entry in the active scope whose key starts with `prefix`. */
  invalidate(prefix: string): void;
  /** Drops everything, in every scope. */
  clear(): void;
};

export function createScopedMemoCache<T>({
  limit,
  ttlMs,
}: {
  /** Maximum entries held across all scopes before the oldest write is evicted. */
  limit: number;
  /** How long an entry is served for. Omit to keep entries until they are evicted. */
  ttlMs?: number;
}): ScopedMemoCache<T> {
  const entries = new Map<string, Entry<T>>();
  const scopedKey = (key: string) => `${getCacheScope()}|${key}`;

  // These caches live as long as the tab does, so the subscription is never
  // torn down — the unsubscribe is deliberately dropped.
  subscribeScope(() => entries.clear());

  return {
    get(key) {
      const scoped = scopedKey(key);
      const entry = entries.get(scoped);
      if (!entry) return undefined;
      if (ttlMs !== undefined && Date.now() - entry.at > ttlMs) {
        entries.delete(scoped);
        return undefined;
      }
      return entry.value;
    },

    setForScope(expectedScope, key, value) {
      if (expectedScope !== getCacheScope()) return;
      const scoped = scopedKey(key);
      // Re-inserting an existing key would keep its original position in the
      // Map's insertion order, so drop it first and let the fresh write go to
      // the back of the eviction queue.
      entries.delete(scoped);
      entries.set(scoped, { at: Date.now(), value });
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },

    invalidate(prefix) {
      const scopedPrefix = scopedKey(prefix);
      for (const key of [...entries.keys()]) {
        if (key.startsWith(scopedPrefix)) entries.delete(key);
      }
    },

    clear() {
      entries.clear();
    },
  };
}
