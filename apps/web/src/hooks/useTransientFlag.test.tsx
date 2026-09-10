import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTransientFlag } from "./useTransientFlag";

function Probe({ durationMs }: { durationMs?: number }) {
  const [saved, setSaved] = useTransientFlag(durationMs);
  return (
    <div>
      <span data-testid="flag">{saved ? "on" : "off"}</span>
      <button type="button" onClick={() => setSaved(true)}>raise</button>
      <button type="button" onClick={() => setSaved(false)}>clear</button>
    </div>
  );
}

const flag = () => screen.getByTestId("flag").textContent;
const click = (name: string) => act(() => { screen.getByRole("button", { name }).click(); });

describe("useTransientFlag", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("turns itself off again", () => {
    render(<Probe />);
    expect(flag()).toBe("off");

    click("raise");
    expect(flag()).toBe("on");

    act(() => { vi.advanceTimersByTime(1999); });
    expect(flag()).toBe("on");

    act(() => { vi.advanceTimersByTime(1); });
    expect(flag()).toBe("off");
  });

  it("restarts the countdown when raised again", () => {
    // Two saves in quick succession: the second confirmation should last a
    // full duration, not whatever was left of the first one's.
    render(<Probe />);
    click("raise");
    act(() => { vi.advanceTimersByTime(1500); });
    click("raise");

    act(() => { vi.advanceTimersByTime(1500); });
    expect(flag()).toBe("on");

    act(() => { vi.advanceTimersByTime(500); });
    expect(flag()).toBe("off");
  });

  it("cancels the pending clear when lowered by hand", () => {
    // Every settings panel drops its "Saved!" the moment a field changes.
    render(<Probe />);
    click("raise");
    click("clear");
    expect(flag()).toBe("off");

    // Nothing left to fire — a surviving timer would be harmless here but is
    // exactly what leaks in the unmount case below.
    act(() => { vi.advanceTimersByTime(5000); });
    expect(flag()).toBe("off");
  });

  it("honours a custom duration", () => {
    render(<Probe durationMs={3000} />);
    click("raise");

    act(() => { vi.advanceTimersByTime(2000); });
    expect(flag()).toBe("on");

    act(() => { vi.advanceTimersByTime(1000); });
    expect(flag()).toBe("off");
  });

  it("ignores a raise from an async continuation that lands after unmount", async () => {
    // The shape every caller has: `await api.save(...)` and then `setSaved(true)`.
    // Closing the settings sheet while that request is in flight runs the
    // continuation against a component that no longer exists — and without the
    // mounted guard it would start a two-second timer that nothing is left to
    // clear, since the cleanup has already run.
    // The setter is handed out from an effect rather than captured during
    // render — assigning to an outer variable mid-render is the same impurity
    // this hook's own guard is about, and a test that models the hazard should
    // not commit it.
    let raise!: (v: boolean) => void;
    function Late({ onReady }: { onReady: (set: (v: boolean) => void) => void }) {
      const [saved, setSaved] = useTransientFlag();
      useEffect(() => { onReady(setSaved); }, [onReady, setSaved]);
      return <span data-testid="flag">{saved ? "on" : "off"}</span>;
    }

    const { unmount } = render(<Late onReady={(set) => { raise = set; }} />);
    unmount();

    const before = vi.getTimerCount();
    act(() => { raise(true); });
    expect(vi.getTimerCount()).toBe(before);
  });

  it("does not set state after the component is gone", () => {
    // The reason this hook exists: three panels called a bare `setTimeout`, so
    // closing the settings sheet within the two seconds after a save updated a
    // component that had already unmounted.
    const onError = vi.fn();
    const { unmount } = render(<Probe />);
    click("raise");
    unmount();

    const spy = vi.spyOn(console, "error").mockImplementation(onError);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
