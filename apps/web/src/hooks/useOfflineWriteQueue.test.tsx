/**
 * The page's half of the offline write queue.
 *
 * The service worker holds the writes and knows how to send them; what it
 * cannot do, on any browser without Background Sync — which is every iPhone —
 * is notice the connection coming back. `navigator.onLine` going true is the
 * page's own signal for exactly that, so the page is what pokes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { QueuedWritesReplayed } from "../api";
import { useOfflineWriteQueue } from "./useOfflineWriteQueue";

const replayQueuedWrites = vi.fn(async () => {});
let announce: ((summary: QueuedWritesReplayed) => void) | null = null;
const unsubscribe = vi.fn();

vi.mock("../api", () => ({
  replayQueuedWrites: () => replayQueuedWrites(),
  onQueuedWritesReplayed: (listener: (summary: QueuedWritesReplayed) => void) => {
    announce = listener;
    return unsubscribe;
  },
}));

const showToast = vi.fn();
vi.mock("./useToast", () => ({ useToast: () => ({ showToast }) }));

const setOnLine = (value: boolean) => vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);

const fire = (event: "online" | "offline") =>
  act(() => {
    window.dispatchEvent(new Event(event));
  });

function Harness() {
  useOfflineWriteQueue();
  return <div data-testid="mounted" />;
}

beforeEach(() => {
  replayQueuedWrites.mockClear();
  showToast.mockClear();
  unsubscribe.mockClear();
  announce = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useOfflineWriteQueue", () => {
  it("asks the worker to send what it is holding as soon as the connection is back", () => {
    setOnLine(false);
    render(<Harness />);
    expect(replayQueuedWrites).not.toHaveBeenCalled();

    setOnLine(true);
    fire("online");

    expect(replayQueuedWrites).toHaveBeenCalledTimes(1);
  });

  it("asks once on mount too, for a queue left over from a previous session", () => {
    // The worker's own fallbacks cover the app being closed, but neither is
    // guaranteed to have run by the time the user is looking at a page built
    // from the rows those writes change.
    setOnLine(true);
    render(<Harness />);

    expect(replayQueuedWrites).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("mounted")).toBeInTheDocument();
  });

  it("says what was sent, since the user was already told it was saved", () => {
    setOnLine(true);
    render(<Harness />);

    act(() => announce?.({ replayed: 3, rejected: 0 }));

    expect(showToast).toHaveBeenCalledWith("Sent 3 changes you made offline.", "success");
  });

  it("counts one change in the singular", () => {
    setOnLine(true);
    render(<Harness />);

    act(() => announce?.({ replayed: 1, rejected: 0 }));

    expect(showToast).toHaveBeenCalledWith("Sent the change you made offline.", "success");
  });

  it("reports a write the server refused rather than losing it in silence", () => {
    // Saying nothing here turns "saved" into a quiet lie, and the only person
    // who can do anything about it never finds out.
    setOnLine(true);
    render(<Harness />);

    act(() => announce?.({ replayed: 2, rejected: 1 }));

    expect(showToast).toHaveBeenCalledWith("Sent 2 changes you made offline.", "success");
    expect(showToast).toHaveBeenCalledWith(
      "One change made offline was refused by the server and has been dropped.",
      "error"
    );
  });

  it("says nothing when the queue was empty", () => {
    setOnLine(true);
    render(<Harness />);

    act(() => announce?.({ replayed: 0, rejected: 0 }));

    expect(showToast).not.toHaveBeenCalled();
  });

  it("stops listening when the shell goes away", () => {
    setOnLine(true);
    const { unmount } = render(<Harness />);

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
