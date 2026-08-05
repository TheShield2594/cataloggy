import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_MAX_AGE_MS, isFresh, readCache, subscribe, writeCache } from "../utils/dataCache";

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

  const setAndCache = useCallback(
    (next: CachedStateUpdater<T>) => {
      const resolved =
        typeof next === "function" ? (next as (previous: T) => T)(valueRef.current) : next;
      valueRef.current = resolved;
      setValue(resolved);
      writeCache(key, resolved);
    },
    [key]
  );

  // A mutation elsewhere in the app invalidates the cache; anything on screen
  // reading this key needs to hear about it rather than sit on a stale value.
  useEffect(
    () =>
      subscribe(key, () => {
        const next = readCache<T>(key, maxAgeMs);
        if (next !== undefined) setValue(next);
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
