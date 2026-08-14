import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast, type ShowToastOptions, type Toast } from "./useToast";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// Clicks below go through fireEvent rather than userEvent: the toast timers are
// faked here, and userEvent's own pointer-event scheduling deadlocks against a
// fake clock it does not own.

let show: (message: string, type?: Toast["type"], options?: ShowToastOptions) => void;

function Harness() {
  show = useToast().showToast;
  return null;
}

const renderToasts = () =>
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  );

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

// A dismissed toast plays its exit animation before it leaves the DOM. jsdom
// never fires animationend on its own, so these tests ride the fallback timer
// that exists for exactly that case — which is also what covers a real browser
// that drops the animation.
const EXIT_MS = 500;
const finishExit = () => advance(EXIT_MS);

// The polite region. Since errors moved to their own assertive sibling, the
// hover/focus pause handlers live on the wrapper around both — which is what
// these fireEvents need to reach, and events fired here bubble to it.
const stack = () => screen.getByRole("status");

describe("ToastProvider", () => {
  it("expires a plain toast after the short default", () => {
    renderToasts();
    act(() => show("Saved"));
    expect(screen.getByText("Saved")).toBeInTheDocument();

    advance(3000);
    finishExit();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("keeps an undoable toast up long enough to notice and act on", () => {
    renderToasts();
    act(() => show("Removed Alien", "info", { action: { label: "Undo", onAction: () => {} } }));

    // Still there well past the plain toast's life — the Undo is the only way
    // back from the removal that raised it.
    advance(3000);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();

    advance(5000);
    finishExit();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("runs the action and closes the toast when Undo is clicked", () => {
    const onAction = vi.fn();
    renderToasts();
    act(() => show("Removed Alien", "info", { action: { label: "Undo", onAction } }));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    finishExit();
    expect(screen.queryByText("Removed Alien")).not.toBeInTheDocument();
  });

  it("does not re-run the action once the toast has been dismissed", () => {
    const onAction = vi.fn();
    renderToasts();
    act(() => show("Removed Alien", "info", { action: { label: "Undo", onAction } }));

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    advance(8000);

    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Removed Alien")).not.toBeInTheDocument();
  });

  it("does not run the action twice when Undo is activated by keyboard mid-exit", () => {
    const onAction = vi.fn();
    renderToasts();
    act(() => show("Removed Alien", "info", { action: { label: "Undo", onAction } }));

    const undo = screen.getByRole("button", { name: "Undo" });
    // The toast is `pointer-events-none` while fading, which stops a second
    // click but not a second Enter on a button the keyboard still holds focus on.
    fireEvent.click(undo);
    fireEvent.click(undo);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(undo).toBeDisabled();
  });

  it("keeps holding the timer when focus leaves but the pointer has not", () => {
    renderToasts();
    act(() => show("Saved"));

    // Clicking Undo or Dismiss focuses a button inside a stack the pointer is
    // already over; the blur that follows must not restart a countdown the
    // pointer is still holding.
    fireEvent.mouseEnter(stack());
    fireEvent.focus(screen.getByRole("button", { name: "Dismiss notification" }));
    fireEvent.blur(screen.getByRole("button", { name: "Dismiss notification" }));

    advance(60_000);
    expect(screen.getByText("Saved")).toBeInTheDocument();

    // Only the pointer leaving releases it.
    fireEvent.mouseLeave(stack());
    advance(3000);
    finishExit();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("ignores focus moving between buttons within the stack", () => {
    renderToasts();
    act(() => show("Removed Alien", "info", { action: { label: "Undo", onAction: () => {} } }));

    const undo = screen.getByRole("button", { name: "Undo" });
    const dismiss = screen.getByRole("button", { name: "Dismiss notification" });

    fireEvent.focus(undo);
    // Tabbing Undo → Dismiss is not focus leaving the stack.
    fireEvent.blur(undo, { relatedTarget: dismiss });
    fireEvent.focus(dismiss);

    advance(60_000);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("gives an error long enough to read the reason it carries", () => {
    renderToasts();
    act(() => show('Created "Watchlist", but couldn\'t add "Alien" (TMDB timed out)', "error"));

    // A success confirmation would be long gone by now.
    advance(3000);
    expect(screen.getByText(/couldn't add "Alien"/)).toBeInTheDocument();

    advance(7000);
    finishExit();
    expect(screen.queryByText(/couldn't add "Alien"/)).not.toBeInTheDocument();
  });

  it("plays the exit animation instead of vanishing outright", () => {
    renderToasts();
    act(() => show("Saved"));

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    // Still mounted, now animating out — and inert, so the fade can't take a
    // second click. jsdom runs no animations and never delivers the
    // animationend that unmounts it in a browser, so the fallback timer is what
    // finishes the job here.
    const toast = screen.getByText("Saved").closest("div");
    expect(toast).toHaveClass("toast-exit");
    expect(toast).toHaveClass("pointer-events-none");

    finishExit();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("holds the timer while the stack is hovered", () => {
    renderToasts();
    act(() => show("Saved"));

    fireEvent.mouseEnter(stack());
    advance(60_000);
    expect(screen.getByText("Saved")).toBeInTheDocument();

    // Only the time left when the pointer arrived is still owed.
    fireEvent.mouseLeave(stack());
    advance(3000);
    finishExit();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("resumes with the remaining time, not a fresh countdown", () => {
    renderToasts();
    act(() => show("Saved"));

    advance(2000);
    fireEvent.mouseEnter(stack());
    advance(60_000);
    fireEvent.mouseLeave(stack());

    // One second was left when the hover started, and one second is what is left.
    advance(999);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    advance(1);
    finishExit();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("holds the timer while the stack has focus", () => {
    renderToasts();
    act(() => show("Saved"));

    // Tabbing to the dismiss button must not be a race against the timer.
    fireEvent.focus(screen.getByRole("button", { name: "Dismiss notification" }));
    advance(60_000);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("pauses a toast raised while the stack is already hovered", () => {
    renderToasts();
    act(() => show("Saved"));
    fireEvent.mouseEnter(stack());

    act(() => show("Also saved"));
    advance(60_000);

    expect(screen.getByText("Also saved")).toBeInTheDocument();
  });

  it("does not leave the pause stuck on after the last toast is dismissed", () => {
    renderToasts();
    act(() => show("Saved"));

    // Dismissing under the pointer empties the stack, and a mouseleave for an
    // element that is no longer under the cursor may never arrive.
    fireEvent.mouseEnter(stack());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    finishExit();

    act(() => show("Next one"));
    advance(3000);
    finishExit();
    expect(screen.queryByText("Next one")).not.toBeInTheDocument();
  });

  // One polite region covering the whole stack announced a failure in the same
  // breath as "Saved", and re-read every toast in it — plus the "+N more"
  // counter — each time a new one arrived.
  describe("live regions", () => {
    it("announces an error assertively and everything else politely", () => {
      renderToasts();
      act(() => show("Saved"));
      act(() => show("Something broke", "error"));

      expect(screen.getByRole("status")).toHaveTextContent("Saved");
      expect(screen.getByRole("status")).not.toHaveTextContent("Something broke");
      expect(screen.getByRole("alert")).toHaveTextContent("Something broke");
    });

    it("mounts both regions before there is anything to say", () => {
      renderToasts();

      // A region created in the same paint as its first message announces
      // nothing — it has to already be there for the insertion to register.
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("makes each toast atomic rather than the region, so one arrival re-reads one toast", () => {
      renderToasts();
      act(() => show("First"));
      act(() => show("Second"));

      const region = screen.getByRole("status");
      expect(region).not.toHaveAttribute("aria-atomic");
      for (const message of ["First", "Second"]) {
        expect(screen.getByText(message).closest("[aria-atomic]")).toHaveAttribute("aria-atomic", "true");
      }
    });

    it("stays announceable from behind a modal, which is where its toasts are raised", () => {
      renderToasts();
      act(() => show("Saved"));

      // useFocusTrap inerts everything beside an open dialog; the toast stack
      // opts out, or an action taken inside a dialog reports nothing.
      expect(screen.getByRole("status").closest("[data-overlay-exempt]")).not.toBeNull();
    });
  });
});
