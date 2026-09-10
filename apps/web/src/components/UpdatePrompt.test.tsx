/**
 * The periodic update check, and its lifetime.
 *
 * The browser only looks for a new service worker when the page navigates, and
 * an installed PWA left resident for weeks may never navigate — so without this
 * interval a household can sit on a stale build indefinitely and the "new
 * version available" prompt never fires.
 *
 * The interval's *lifetime* needs its own care, because `onRegisteredSW` is
 * called when registration resolves, which can be after this component has gone
 * away: an interval armed then is one nothing is left to clear.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { lastRegisterSWOptions, resetRegisterSWStub } from "../test/pwa-register-stub";
import { UpdatePrompt } from "./UpdatePrompt";

vi.mock("../api", () => ({ tellServiceWorkerWhereTheApiIs: vi.fn(async () => {}) }));

const HOUR_MS = 60 * 60 * 1000;

/** Drives the callback vite-plugin-pwa would call once a worker registered. */
const reportRegistered = (registration?: { update: () => Promise<void> }) =>
  lastRegisterSWOptions()?.onRegisteredSW?.(
    "/sw.js",
    registration as unknown as ServiceWorkerRegistration | undefined
  );

beforeEach(() => {
  vi.useFakeTimers();
  resetRegisterSWStub();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the periodic update check", () => {
  it("asks the registration for an update every hour", () => {
    const update = vi.fn(async () => {});
    render(<UpdatePrompt />);

    reportRegistered({ update });
    expect(update).not.toHaveBeenCalled();

    vi.advanceTimersByTime(HOUR_MS);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HOUR_MS * 2);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it("does not ask while the device has no connection", () => {
    // A check with no network is a fetch that can only fail, and a failed one
    // puts a console error in front of a self-hoster whose install is fine.
    const update = vi.fn(async () => {});
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<UpdatePrompt />);

    reportRegistered({ update });
    vi.advanceTimersByTime(HOUR_MS * 3);

    expect(update).not.toHaveBeenCalled();
  });

  it("stops checking once the component is gone", () => {
    const update = vi.fn(async () => {});
    const { unmount } = render(<UpdatePrompt />);
    reportRegistered({ update });

    unmount();
    vi.advanceTimersByTime(HOUR_MS * 3);

    expect(update).not.toHaveBeenCalled();
  });

  it("never arms an interval for a registration that resolved after unmount", () => {
    // `registerSW` resolves on its own schedule, so this callback can arrive
    // after the effect's cleanup has already run — at which point `clearInterval`
    // has nothing to clear and the interval it arms outlives everything that
    // could stop it. A StrictMode double-mount is the reliable way to see it.
    const update = vi.fn(async () => {});
    const { unmount } = render(<UpdatePrompt />);

    unmount();
    reportRegistered({ update });
    vi.advanceTimersByTime(HOUR_MS * 3);

    expect(update).not.toHaveBeenCalled();
  });

  it("survives a registration that reports no registration object at all", () => {
    render(<UpdatePrompt />);

    expect(() => reportRegistered(undefined)).not.toThrow();
    expect(() => vi.advanceTimersByTime(HOUR_MS)).not.toThrow();
  });
});
