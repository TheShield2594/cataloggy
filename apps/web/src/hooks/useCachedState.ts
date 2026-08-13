import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_MAX_AGE_MS,
  getCacheScope,
  isFresh,
  readCache,
  subscribe,
  subscribeScope,
  writeCacheForScope,
} from "../utils/dataCache";

export type CachedStateOptions = {
  /** Older than this and the cached value isn't shown at all. */
  maxAgeMs?: number;
};

export type CachedStateUpdater<T> = T | ((previous: T) => T);

export type CachedState<T> = [
  value: T,
  setValue: (next: CachedStateUpdater<T>) => void,
  meta: {
    /** True when this mount started with a cached value — so no spinner is owed. */
    hadCachedValue: boolean;
    /** True when the cached value is recent enough that a refetch can be skipped. */
    isFresh: (freshMs?: number) => boolean;
  },
];

/**
 * `useState` that survives unmounting, backed by the shared data cache.
 *
 * Written as a drop-in rather than as a fetch-owning hook on purpose. These
 * pages each carry their own retry buttons, staleness tokens and per-section
 * error states, all of which work; the only thing wrong with them was that
 * leaving a page threw the data away, so coming back showed a spinner over an
 * answer the tab already had. Swapping `useState` for this keeps every one of
 * those behaviours and fixes exactly that.
 *
 * The page's existing load still runs on mount, so the data is refreshed either
 * way — it just happens underneath the content instead of in place of it.
 */
export function useCachedState<T>(
  key: string,
  fallback: T,
  options: CachedStateOptions = {}
): CachedState<T> {
  const { maxAgeMs = DEFAULT_MAX_AGE_MS } = options;

  // Read during the initialiser, not in an effect: an effect runs after the
  // first paint, which is one frame of spinner — the frame this exists to remove.
  const [value, setValue] = useState<T>(() => readCache<T>(key, maxAgeMs) ?? fallback);
  const hadCachedValueRef = useRef(readCache<T>(key, maxAgeMs) !== undefined);

  // Some keys are derived from state — the calendar's day range, the games
  // page's sort order — so the key can change without the component
  // remounting. `useState`'s initialiser runs once, so without this the hook
  // would keep serving the previous key's value under the new key's name. Done
  // during render rather than in an effect for the same reason as the
  // initialiser: an effect would paint the wrong range for a frame first.
  const previousKeyRef = useRef(key);
  if (previousKeyRef.current !== key) {
    previousKeyRef.current = key;
    const cached = readCache<T>(key, maxAgeMs);
    hadCachedValueRef.current = cached !== undefined;
    setValue(cached ?? fallback);
  }

  // Callers pass updater functions (`setEvents(prev => [...prev, ...page])`), so
  // this has to accept them to be a drop-in. The updater is resolved here rather
  // than inside `setValue`, because writing to the cache notifies subscribers,
  // and React may invoke a state updater more than once — a side effect in there
  // would fire during render. The ref keeps consecutive calls in one tick
  // chaining correctly without depending on a re-render in between.
  const valueRef = useRef(value);
  valueRef.current = value;

  // The identity this mount belongs to, captured once and deliberately never
  // updated. Pages issue requests and set the answer when it lands; a profile
  // switch in between means the answer describes whoever asked for it, not
  // whoever is looking now. Writing it under the live scope is how one profile
  // ends up painting another's Continue Watching.
  //
  // Not refreshed when the scope moves, even though this component may still be
  // mounted at that instant: the unmount that a profile switch triggers is a
  // render behind the switch itself, so a ref updated on the change would be
  // pointing at the new identity by the time the old request resolves — which
  // is the exact leak. Pinning it means a stale write is dropped instead. Every
  // consumer of this hook is a route page, and those remount on a switch with a
  // fresh scope of their own.
  const scopeRef = useRef(getCacheScope());

  const setAndCache = useCallback(
    (next: CachedStateUpdater<T>) => {
      const resolved =
        typeof next === "function" ? (next as (previous: T) => T)(valueRef.current) : next;
      valueRef.current = resolved;
      setValue(resolved);
      writeCacheForScope(scopeRef.current, key, resolved);
    },
    [key]
  );

  // A mutation elsewhere in the app invalidates the cache; anything on screen
  // reading this key needs to hear about it rather than sit on a stale value.
  // An empty read is ignored on purpose: an invalidation is followed by a
  // refetch, and blanking the page in between is worse than showing the row
  // that is about to be replaced.
  useEffect(
    () =>
      subscribe(key, () => {
        const next = readCache<T>(key, maxAgeMs);
        if (next !== undefined) setValue(next);
      }),
    [key, maxAgeMs]
  );

  // A scope change is the opposite case: an empty read there means the value on
  // screen belongs to an identity that is no longer signed in, so it goes.
  // `fallback` is read through a ref because callers pass literals (`[]`,
  // `null`), which would otherwise re-run this effect on every render.
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  useEffect(
    () =>
      subscribeScope(() => {
        const next = readCache<T>(key, maxAgeMs) ?? fallbackRef.current;
        valueRef.current = next;
        setValue(next);
      }),
    [key, maxAgeMs]
  );

  const checkFresh = useCallback((freshMs?: number) => isFresh(key, freshMs), [key]);

  return [
    value,
    setAndCache,
    { hadCachedValue: hadCachedValueRef.current, isFresh: checkFresh },
  ];
}
