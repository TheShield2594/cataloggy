import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExitAnimation } from "./useExitAnimation";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// jsdom delivers no animation events at all (the reason the toast tests ride
// the exit fallback timer), so the animationend-driven path is exercised by
// calling the returned handler with a hand-built event — which is also the
// only way to control `target` vs `currentTarget`.
let handleExitEnd: (event: React.AnimationEvent) => void;

const exitEvent = (target: EventTarget, currentTarget: EventTarget) =>
  ({ target, currentTarget } as unknown as React.AnimationEvent);

function Overlay({ onClosed }: { onClosed: () => void }) {
  const { exiting, requestClose, onExitAnimationEnd } = useExitAnimation(onClosed);
  handleExitEnd = onExitAnimationEnd;
  return (
    <div data-testid="overlay" className={exiting ? "overlay-exit" : ""}>
      <button type="button" onClick={requestClose}>close</button>
      <div data-testid="child" />
    </div>
  );
}

describe("useExitAnimation", () => {
  it("marks the surface as exiting instead of closing outright", () => {
    const onClosed = vi.fn();
    render(<Overlay onClosed={onClosed} />);

    fireEvent.click(screen.getByRole("button", { name: "close" }));

    expect(screen.getByTestId("overlay")).toHaveClass("overlay-exit");
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("closes when the element's own exit animation ends", () => {
    const onClosed = vi.fn();
    render(<Overlay onClosed={onClosed} />);
    const overlay = screen.getByTestId("overlay");

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    act(() => handleExitEnd(exitEvent(overlay, overlay)));

    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("ignores animationend bubbling up from a child mid-exit", () => {
    // A star-pop or shimmer finishing inside the panel must not cut the
    // panel's own exit short.
    const onClosed = vi.fn();
    render(<Overlay onClosed={onClosed} />);
    const overlay = screen.getByTestId("overlay");
    const child = screen.getByTestId("child");

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    act(() => handleExitEnd(exitEvent(child, overlay)));

    expect(onClosed).not.toHaveBeenCalled();
  });

  it("ignores an entrance animation ending before any close was requested", () => {
    const onClosed = vi.fn();
    render(<Overlay onClosed={onClosed} />);
    const overlay = screen.getByTestId("overlay");

    act(() => handleExitEnd(exitEvent(overlay, overlay)));

    expect(onClosed).not.toHaveBeenCalled();
  });

  it("falls back to a timer when animationend never arrives", () => {
    // jsdom runs no animations; a real browser can drop one too.
    const onClosed = vi.fn();
    render(<Overlay onClosed={onClosed} />);

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    act(() => { vi.advanceTimersByTime(500); });

    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("closes exactly once when both the animation and the fallback fire", () => {
    const onClosed = vi.fn();
    render(<Overlay onClosed={onClosed} />);
    const overlay = screen.getByTestId("overlay");

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    act(() => handleExitEnd(exitEvent(overlay, overlay)));
    act(() => { vi.advanceTimersByTime(500); });

    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
