// A page that refetches on every mount shows a spinner every time you come back
// to it, even when the answer is the one already on screen a second ago. The
// service worker's stale-while-revalidate makes that response fast in
// production, but the component can't know that: it starts at `loading: true`
// and waits on a promise, so the spinner renders regardless.
//
// This is the piece that closes that gap — a cache the render pass can read
// *synchronously*, so a revisit paints last-known data in its first frame and
// revalidates behind it. Nothing here replaces the service worker: that layer
// survives a reload and works offline, this one removes the spinner.

type Entry = { value: unknown; at: number };

const entries = new Map<string, Entry>();
// Keyed on the *bare* key, not the scoped one. A subscription registered under
// `oldScope|key` becomes unreachable the moment the scope moves, so a component
// that outlives a profile switch would stop hearing about its own key forever —
// silently, and for the rest of the tab's life. The scope is applied in `notify`
// instead, where it can be re-read on every write.
const subscribers = new Map<string, Set<() => void>>();
// A scope change is a different event from a write or an invalidation: those
// mean "this key moved", it means "the identity behind every key moved". Key
// subscribers deliberately ignore a read that comes back empty (holding the last
// value through a mutation's invalidate-then-refetch is the point), which is
// exactly the wrong response to a cleared scope — hence its own channel.
const scopeListeners = new Set<() => void>();

/** How long a cached value is served without a background refetch. */
export const DEFAULT_FRESH_MS = 30_000;
/**
 * Past this, a value is too old to show at all and the caller waits for the
 * network instead. Coming back after lunch to a "watched this week" count from
 * before lunch, with no indication it is stale, is worse than a spinner.
 */
export const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

// Every entry is scoped to the identity that fetched it. Two profiles on one
// device must never see each other's rows, and a rotated token means a
// different install entirely — same reasoning as the service worker's
// partitioned cache keys, applied to memory.
let scope = "";

export function setCacheScope(next: string): void {
  if (next === scope) return;
  scope = next;
  // Entries under the old scope can never be read again — their keys are
  // unreachable — so drop them rather than leak them for the tab's lifetime.
  entries.clear();
  for (const listener of scopeListeners) listener();
}

/**
 * Fires when the active identity changes, after the entries are cleared.
 *
 * Anything holding a rendered copy of a cached value needs to hear this: the
 * copy belongs to the previous identity, and the cache it came from is gone.
 */
export function subscribeScope(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

const scopedKey = (key: string) => `${scope}|${key}`;

/** The identity entries are currently being written under. */
export function getCacheScope(): string {
  return scope;
}

/**
 * Writes only if `expectedScope` is still the active one.
 *
 * For anything that starts a request and writes the answer later: a profile
 * switch in between means the answer belongs to an identity that is no longer
 * active, and storing it under the new scope would show one profile another's
 * data. Callers capture the scope before they await and pass it back here.
 */
export function writeCacheForScope(expectedScope: string, key: string, value: unknown): void {
  if (expectedScope !== scope) return;
  writeCache(key, value);
}

export function readCache<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE_MS): T | undefined {
  const entry = entries.get(scopedKey(key));
  if (!entry) return undefined;
  if (Date.now() - entry.at > maxAgeMs) return undefined;
  return entry.value as T;
}

export function isFresh(key: string, freshMs = DEFAULT_FRESH_MS): boolean {
  const entry = entries.get(scopedKey(key));
  return !!entry && Date.now() - entry.at <= freshMs;
}

export function writeCache(key: string, value: unknown): void {
  entries.set(scopedKey(key), { value, at: Date.now() });
  notify(key);
}

function notify(key: string): void {
  const listeners = subscribers.get(key);
  if (!listeners) return;
  for (const listener of listeners) listener();
}

export function subscribe(key: string, listener: () => void): () => void {
  let listeners = subscribers.get(key);
  if (!listeners) {
    listeners = new Set();
    subscribers.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) subscribers.delete(key);
  };
}

/**
 * Drops cached entries whose key starts with `prefix`, so the next read goes to
 * the network. Called after a mutation: adding to a list has to be visible on
 * the lists page immediately, not in thirty seconds.
 */
export function invalidate(prefix: string): void {
  const scopedPrefix = scopedKey(prefix);
  for (const key of [...entries.keys()]) {
    if (key.startsWith(scopedPrefix)) {
      entries.delete(key);
      // Back to the bare key the subscriber registered under — everything in
      // `entries` is stored scoped, and the prefix that matched carries it.
      notify(key.slice(scopedPrefix.length - prefix.length));
    }
  }
}

export function invalidateAll(): void {
  entries.clear();
  for (const listeners of subscribers.values()) {
    for (const listener of listeners) listener();
  }
}

/** Test seam. */
export function resetDataCacheForTests(): void {
  entries.clear();
  subscribers.clear();
  scopeListeners.clear();
  scope = "";
}
