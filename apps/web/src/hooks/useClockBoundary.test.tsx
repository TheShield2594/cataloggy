import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { msUntilNextBoundary, useClockBoundary } from "./useClockBoundary";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const at = (hour: number, minute = 0) => new Date(2026, 4, 15, hour, minute, 0, 0);

describe("msUntilNextBoundary", () => {
  it("waits for the next midnight by default", () => {
    expect(msUntilNextBoundary(at(9, 30))).toBe(14 * HOUR + 30 * MINUTE);
    expect(msUntilNextBoundary(at(23, 59))).toBe(MINUTE);
  });

  it("lands on the boundary itself rather than firing again immediately", () => {
    // Woken exactly at midnight, the next wake is the following one.
    expect(msUntilNextBoundary(at(0))).toBe(24 * HOUR);
  });

  it("never schedules a spin, whatever the clock does", () => {
    // A DST jump can put the computed boundary in the past; the floor keeps a
    // timer that would otherwise fire in a tight loop off the event loop.
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 1, 30, 59]) {
        expect(msUntilNextBoundary(at(hour, minute))).toBeGreaterThanOrEqual(MINUTE);
      }
    }
  });
});

describe("useClockBoundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(22, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-reads the clock at midnight, so an overnight tab stops saying Today", () => {
    const { result } = renderHook(() => useClockBoundary());
    expect(result.current.getDate()).toBe(15);

    act(() => {
      vi.advanceTimersByTime(2 * HOUR + MINUTE);
    });

    expect(result.current.getDate()).toBe(16);
  });

  it("keeps the same Date while the day has not changed", () => {
    // Callers key memos — and, on the calendar, a fetch — on this value; a new
    // object every hour would invalidate them for a label that did not change.
    const { result } = renderHook(() => useClockBoundary());
    const first = result.current;

    act(() => {
      vi.advanceTimersByTime(HOUR);
    });

    expect(result.current).toBe(first);
  });

  it("re-reads on the way back from a suspend rather than waiting out a stale timer", () => {
    const { result } = renderHook(() => useClockBoundary());

    // A laptop asleep across midnight wakes with yesterday's timeout pending.
    act(() => {
      vi.setSystemTime(at(9, 0).getTime() + 24 * HOUR);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.getDate()).toBe(16);
  });

  it("takes the caller's cutoffs, which is how the dashboard wakes for its greeting", () => {
    const { result } = renderHook(() => useClockBoundary([0, 5, 12, 18], () => false));
    const first = result.current;

    act(() => {
      vi.advanceTimersByTime(2 * HOUR + MINUTE); // 22:00 → past the 00:00 cutoff
    });
    expect(result.current).not.toBe(first);

    const afterMidnight = result.current;
    act(() => {
      vi.advanceTimersByTime(5 * HOUR + MINUTE); // → past the 05:00 cutoff
    });
    expect(result.current).not.toBe(afterMidnight);
    expect(result.current.getHours()).toBe(5);
  });

  it("does not re-arm on arguments rebuilt each render", () => {
    // A literal has a new identity every render. With these in the effect's
    // dependencies that tore the timer down and set it up again — and since
    // setting up re-reads the clock, an `isEquivalent` that says "different"
    // spun the component in a render loop.
    const { rerender } = renderHook(() => useClockBoundary([0, 5, 12, 18], () => false));
    expect(vi.getTimerCount()).toBe(1);

    rerender();
    rerender();

    expect(vi.getTimerCount()).toBe(1);
  });

  it("stops its timer when the component goes away", () => {
    const { unmount } = renderHook(() => useClockBoundary());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
