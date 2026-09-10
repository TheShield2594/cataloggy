import { act, render, screen } from "@testing-library/react";
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
