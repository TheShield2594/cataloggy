import { useEffect, useRef, useState } from "react";

/**
 * A clock that re-reads itself when a label derived from it would change.
 *
 * Anything computed from `new Date()` at render — "Today", a greeting, the
 * date in a header — is frozen at mount, and a tab left open overnight then
 * labels tomorrow's episodes "Today" and yesterday's watches "Today". Polling
 * would fix it at the cost of a timer running all night; waking at the
 * boundaries that actually change the label costs a re-render or four a day.
 */

// Midnight only: enough for anything that asks what day it is, which is what
// every caller but the dashboard header needs.
const MIDNIGHT_ONLY: readonly number[] = [0];

const onSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/**
 * How long until the next hour in `cutoffHours` — the hours at which a
 * clock-derived label changes, in ascending order. Never returns less than a
 * minute: a DST shift can land the "next" boundary in the past, and a
 * zero-delay timeout that reschedules itself would spin.
 */
export function msUntilNextBoundary(now: Date, cutoffHours: readonly number[] = MIDNIGHT_ONLY): number {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  const nextCutoff = cutoffHours.find((hour) => hour > now.getHours());
  if (nextCutoff === undefined) {
    next.setDate(next.getDate() + 1);
    next.setHours(cutoffHours[0] ?? 0);
  } else {
    next.setHours(nextCutoff);
  }
  return Math.max(next.getTime() - now.getTime(), 60_000);
}

/**
 * The current time, re-read at each of `cutoffHours` (local time).
 *
 * `isEquivalent` says when two instants would render identically; returning
 * the previous `Date` for those lets React bail out of the re-render, so the
 * common case — the effect running microseconds after the first render — costs
 * nothing, and a memo keyed on the returned value is not invalidated for a
 * change that shows up nowhere.
 *
 * Both arguments are held in refs rather than in the effect's dependencies, so
 * passing a literal (`useClockBoundary([0, 12])`) is safe: a new identity every
 * render would otherwise tear down and re-arm the timer each time, and — since
 * setting up sets the clock — spin the component in a render loop. The cost is
 * that a *changed* cutoff list takes effect at the next wake rather than
 * immediately, which no caller needs sooner.
 */
export function useClockBoundary(
  cutoffHours: readonly number[] = MIDNIGHT_ONLY,
  isEquivalent: (a: Date, b: Date) => boolean = onSameDay
): Date {
  const [now, setNow] = useState(() => new Date());
  const cutoffHoursRef = useRef(cutoffHours);
  const isEquivalentRef = useRef(isEquivalent);

  useEffect(() => {
    cutoffHoursRef.current = cutoffHours;
    isEquivalentRef.current = isEquivalent;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const read = (current: Date) => {
      setNow((previous) => (isEquivalentRef.current(previous, current) ? previous : current));
    };

    const schedule = (current: Date) => {
      timer = setTimeout(() => {
        const updated = new Date();
        read(updated);
        schedule(updated);
      }, msUntilNextBoundary(current, cutoffHoursRef.current));
    };

    // A suspended laptop wakes with a timeout that was scheduled yesterday
    // still pending, so re-read the clock on the way back rather than wait it
    // out.
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      const updated = new Date();
      read(updated);
      schedule(updated);
    };

    // Schedule from the same value the page is showing. The clock can cross a
    // cutoff between the first render and this effect, and scheduling from a
    // fresher Date than the one on screen would leave the two disagreeing
    // until the *next* cutoff — a stale label for hours, not milliseconds.
    const current = new Date();
    read(current);
    schedule(current);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return now;
}
