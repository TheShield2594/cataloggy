import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A search box's results: debounced, cancelled on the next keystroke, and
 * guarded so only the newest answer is ever shown.
 *
 * The Lists and Games add-dialogs had this written out twice — a timer ref, an
 * AbortController ref, a request-id counter, and the same four `if this isn't
 * the newest request, return` checks — and the copies had already drifted in
 * ways nobody chose: one aborted on unmount and the other also cleared its
 * pending timer, one cleared the spinner by request id and the other by
 * controller identity. The search page's own guard is a third variant again.
 *
 * Both halves of the guard are needed and neither is enough alone: the abort
 * stops a superseded request that hasn't answered yet, and the id check stops
 * one that answered anyway — an abort is not synchronous, and a request that
 * fans out (Lists searches movies and series at once) can have one half already
 * resolved.
 */
export type DebouncedSearch<T> = {
  results: T[];
  /** For a caller that edits a row in place — marking one "added", say. */
  setResults: (update: T[] | ((previous: T[]) => T[])) => void;
  searching: boolean;
  /** The failure message, or null. Cleared when a new search starts. */
  error: string | null;
  setError: (error: string | null) => void;
};

export type DebouncedSearchOptions = {
  delayMs?: number | undefined;
  /**
   * Runs before each search that is actually issued, for state the caller keeps
   * beside the results — a "not configured yet" notice, say.
   */
  onStart?: (() => void) | undefined;
  /**
   * Handles a failure the caller would rather render itself. Returning
   * `"handled"` leaves `error` null and empties the results; anything else
   * falls through to the message.
   */
  onError?: ((error: unknown) => "handled" | void) | undefined;
};

export function useDebouncedSearch<T>(
  query: string,
  /** Must be stable — wrap it in `useCallback`, as the effect below re-runs on its identity. */
  search: (query: string, signal: AbortSignal) => Promise<T[]>,
  options: DebouncedSearchOptions = {}
): DebouncedSearch<T> {
  const { delayMs = 350, onStart, onError } = options;

  const [results, setResults] = useState<T[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Latest, so the effect below doesn't re-run — and re-search — every time a
  // caller passes a fresh closure for either of these. Assigned after the
  // render rather than during it: nothing reads them until a debounce fires,
  // which is several hundred milliseconds after the commit.
  const onStartRef = useRef(onStart);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onStartRef.current = onStart;
    onErrorRef.current = onError;
  });

  const run = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    onStartRef.current?.();
    setSearching(true);
    setError(null);
    try {
      const next = await search(q, controller.signal);
      if (requestIdRef.current !== requestId) return;
      setResults(next);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (onErrorRef.current?.(err) === "handled") {
        setResults([]);
        return;
      }
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      if (requestIdRef.current === requestId) setSearching(false);
    }
  }, [search]);

  useEffect(() => {
    if (!query.trim()) {
      // An emptied box is an answered question, not a pending one: whatever is
      // in flight is abandoned and the spinner goes with it, rather than
      // landing results for a query nobody can still see.
      requestIdRef.current++;
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void run(query), delayMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, run, delayMs]);

  // Closing the dialog mid-search must not leave the request running, and its
  // answer must not set state on a component that is gone.
  useEffect(() => () => {
    requestIdRef.current++;
    abortRef.current?.abort();
  }, []);

  return { results, setResults, searching, error, setError };
}
