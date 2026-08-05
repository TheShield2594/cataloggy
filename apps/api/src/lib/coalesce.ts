// A read-through cache only collapses the callers that arrive *after* the first
// one has finished. The bursts this API actually sees do the opposite: opening a
// detail panel fires six requests for one title at the same instant, and they
// all miss the cache together, so all six go upstream. `profileLookups` in
// cache.ts already solved this for one case by sharing the in-flight promise;
// this is that idea with the specifics taken out.
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Runs `work` under `key`, or joins the run already in progress under that key.
 *
 * The shared promise is removed as soon as it settles, so this only ever merges
 * genuinely concurrent work — it is a stampede guard, never a cache, and a
 * caller that arrives a millisecond after the previous one finished gets a fresh
 * run. A rejection propagates to everyone who joined, which is the same outcome
 * they would each have reached on their own.
 */
export function coalesce<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const shared = work().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, shared);
  return shared;
}

/** Test seam: in-flight entries are process-wide and would leak between cases. */
export function clearCoalescedForTests(): void {
  inFlight.clear();
}

/** Exposed for assertions about merging; not meaningful outside tests. */
export function inFlightCountForTests(): number {
  return inFlight.size;
}
