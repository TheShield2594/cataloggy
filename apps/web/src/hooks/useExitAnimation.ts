import { useCallback, useEffect, useRef, useState } from "react";

// A shade over the longest `.overlay-*-exit` duration in index.css. The
// unmount is driven by animationend; this backstops the cases where that event
// never arrives — a browser that drops the animation, or jsdom in tests, which
// runs no animations at all.
const EXIT_FALLBACK_MS = 500;

/**
 * The toast's exit pattern, extracted for every other overlay: closing is a
 * two-step — mark the surface as exiting so its `.overlay-exit` animation
 * plays, then actually close (usually: let the parent unmount it) on the
 * animationend that exit raises.
 *
 * Usage in an overlay that a parent unmounts via `onClose`:
 *
 *   const { exiting, requestClose, onExitAnimationEnd } = useExitAnimation(onClose);
 *
 * - route every close trigger (Escape, scrim click, close button) through
 *   `requestClose` instead of `onClose`;
 * - toggle `overlay-exit` onto the animated elements with `exiting`;
 * - attach `onExitAnimationEnd` to the element whose exit animation should
 *   drive the close — it ignores bubbled animationend events from children
 *   (a mid-exit `star-pop`, say), and anything before `requestClose`.
 *
 * A component that stays mounted across open/close cycles (the command
 * palette, the theme popover) must call `reset()` when it opens, or the next
 * open would render already-exiting.
 */
export function useExitAnimation(onClosed: () => void) {
  const [exiting, setExiting] = useState(false);
  // Read by the stable animationend handler; `onClosed` in a ref so a new
  // callback identity doesn't churn effects.
  const exitingRef = useRef(false);
  const finishedRef = useRef(false);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const finish = useCallback(() => {
    // The fallback timer and the animationend can both arrive; only the first
    // one closes.
    if (finishedRef.current) return;
    finishedRef.current = true;
    onClosedRef.current();
  }, []);

  const requestClose = useCallback(() => {
    exitingRef.current = true;
    setExiting(true);
  }, []);

  const reset = useCallback(() => {
    exitingRef.current = false;
    finishedRef.current = false;
    setExiting(false);
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const fallback = setTimeout(finish, EXIT_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [exiting, finish]);

  const onExitAnimationEnd = useCallback(
    (event: React.AnimationEvent) => {
      if (exitingRef.current && event.target === event.currentTarget) finish();
    },
    [finish]
  );

  return { exiting, requestClose, onExitAnimationEnd, reset };
}
