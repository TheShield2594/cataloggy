import { useCallback, useEffect, useRef, useState } from "react";
import { useCachedState } from "./useCachedState";

/**
 * One independently-loading block of a page: its value, whether it is loading,
 * whether it failed, and the guard that keeps the newest answer.
 *
 * The dashboard had this written out five times — a `useRef` counter, two
 * `useState` flags, and three `token.current === token` checks per loader — and
 * the copies had drifted. One of them read the counter without advancing it,
 * which made it no guard at all in the direction that matters: a Retry never
 * invalidated the request it was retrying, so whichever finished last won, and
 * a stale failure could land on top of good recommendations.
 *
 * The value lives in `useCachedState`, so a section loaded once renders from
 * cache while it refetches — which is why `loading` starts false when there was
 * something cached to show.
 */

export type DashboardSection<T> = {
  value: T;
  loading: boolean;
  failed: boolean;
  /** Fetch, then apply — unless a newer call has started in the meantime. */
  load: () => Promise<void>;
  /**
   * Marks whatever is in flight as superseded and returns the token of the run
   * that replaces it, for a caller that has to coordinate two sections at once.
   * Pass the token back to `isCurrent` to ask whether that run is still newest.
   */
  claim: () => number;
  isCurrent: (token: number) => boolean;
  setLoading: (loading: boolean) => void;
  setFailed: (failed: boolean) => void;
  /** Writes the value directly, for a caller that already has one. */
  set: (value: T) => void;
};

export function useDashboardSection<TValue, TFetched = TValue>(
  /** The `useCachedState` key, and what a failure is logged under. */
  key: string,
  initial: TValue,
  fetcher: () => Promise<TFetched>,
  options: {
    /**
     * How the fetched value becomes the section's value, for a section that
     * writes something beside it — the recommendation rails also carry a
     * per-title "why this" line. Runs only when this run is still the newest,
     * so the pair is written together or not at all.
     */
    apply?: ((fetched: TFetched, set: (value: TValue) => void) => void) | undefined;
    /**
     * Runs instead of the default "record the failure" when the fetch throws,
     * for a section with something more to say — the trending rail
     * distinguishes "TMDB is not configured" from any other error. Also only
     * when this run is still the newest.
     */
    onError?: ((error: unknown) => void) | undefined;
  } = {}
): DashboardSection<TValue> {
  const [value, set, meta] = useCachedState<TValue>(key, initial);
  const [loading, setLoading] = useState(!meta.hadCachedValue);
  const [failed, setFailed] = useState(false);
  const token = useRef(0);

  const claim = useCallback(() => ++token.current, []);
  const isCurrent = useCallback((claimed: number) => token.current === claimed, []);

  /*
   * The fetcher and its two callbacks are read from a ref rather than closed
   * over, so that `load` is stable for the life of the section.
   *
   * That is not a nicety: the effect that runs these on mount and on a profile
   * switch is keyed on `load`, so a `load` that changed identity every render
   * would re-run the effect every render — which is an infinite loop, and
   * exactly what an inline `apply` arrow at a call site produces. Holding them
   * here means a caller cannot cause it by writing the obvious thing.
   */
  const latest = useRef({ fetcher, ...options });
  useEffect(() => {
    latest.current = { fetcher, ...options };
  });

  const load = useCallback(async () => {
    const claimed = ++token.current;
    setLoading(true);
    setFailed(false);
    try {
      const fetched = await latest.current.fetcher();
      if (token.current !== claimed) return;
      const apply = latest.current.apply;
      if (apply) apply(fetched, set);
      else set(fetched as unknown as TValue);
    } catch (error) {
      console.error(`Failed to load ${key}:`, error);
      if (token.current !== claimed) return;
      const onError = latest.current.onError;
      if (onError) onError(error);
      else setFailed(true);
    } finally {
      if (token.current === claimed) setLoading(false);
    }
    // `set` is useCachedState's setter, memoised on the key.
  }, [key, set]);

  return { value, loading, failed, load, claim, isCurrent, setLoading, setFailed, set };
}
