import { useCallback, useEffect, useRef, useState } from "react";

/** How long a "Saved!" sits before it fades. */
const DEFAULT_TRANSIENT_MS = 2000;

/**
 * A boolean that turns itself off again — the "Saved!" / "Copied" confirmation
 * every settings panel shows after a successful write.
 *
 * Eight components had grown their own copy of this, and they had not grown it
 * the same way: five kept the timer in a ref and cleared it on unmount, and
 * three called bare `setTimeout`, so unmounting during the two seconds (closing
 * the settings sheet right after saving, which is the normal thing to do) set
 * state on a component that no longer existed. This owns the timer instead.
 *
 * The setter is deliberately shaped like the `setSaved` it replaces, so the
 * call sites did not have to change:
 *
 *   const [saved, setSaved] = useTransientFlag();
 *   ...
 *   setSaved(true);   // shows, then clears itself
 *   setSaved(false);  // clears now, and cancels the pending clear
 *
 * Raising it while it is already up restarts the countdown rather than letting
 * the first save's timer cut the second save's confirmation short.
 */
export function useTransientFlag(
  durationMs: number = DEFAULT_TRANSIENT_MS
): [boolean, (next: boolean) => void] {
  const [on, setOn] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const set = useCallback(
    (next: boolean) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = undefined;
      setOn(next);
      if (!next) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        setOn(false);
      }, durationMs);
    },
    [durationMs]
  );

  return [on, set];
}
