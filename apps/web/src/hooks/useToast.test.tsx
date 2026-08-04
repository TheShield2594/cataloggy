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

describe("ToastProvider", () => {
  it("expires a plain toast after the short default", () => {
    renderToasts();
    act(() => show("Saved"));
    expect(screen.getByText("Saved")).toBeInTheDocument();

    advance(3000);
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
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("runs the action and closes the toast when Undo is clicked", () => {
    const onAction = vi.fn();
    renderToasts();
    act(() => show("Removed Alien", "info", { action: { label: "Undo", onAction } }));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(onAction).toHaveBeenCalledTimes(1);
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
});
