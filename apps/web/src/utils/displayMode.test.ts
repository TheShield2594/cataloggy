import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDisplayMode, isStandalone, watchDisplayMode } from "./displayMode";

type ModeListener = () => void;

const listeners: ModeListener[] = [];
const disposers: Array<() => void> = [];

/** Stub matchMedia so that only the given display modes report a match. */
function mockDisplayModes(...modes: string[]) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: modes.some((mode) => query === `(display-mode: ${mode})`),
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener: (_type: string, listener: ModeListener) => listeners.push(listener),
        removeEventListener: (_type: string, listener: ModeListener) => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  );
}

function viewportMeta() {
  const existing = document.querySelector('meta[name="viewport"]');
  if (existing) return existing;
  const meta = document.createElement("meta");
  meta.setAttribute("name", "viewport");
  meta.setAttribute("content", "width=device-width, initial-scale=1.0, viewport-fit=cover");
  document.head.appendChild(meta);
  return meta;
}

/** iOS < 16.4 reports being installed only through `navigator.standalone`. */
function setNavigatorStandalone(value: boolean | undefined) {
  Object.defineProperty(window.navigator, "standalone", { value, configurable: true });
}

function pinch() {
  const event = new Event("gesturestart", { bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  listeners.length = 0;
  setNavigatorStandalone(undefined);
  document.querySelector('meta[name="viewport"]')?.remove();
  delete document.documentElement.dataset.displayMode;
});

describe("isStandalone", () => {
  it("matches every installed display mode, not just standalone", () => {
    for (const mode of ["standalone", "fullscreen", "minimal-ui"]) {
      mockDisplayModes(mode);
      expect(isStandalone(), mode).toBe(true);
    }
  });

  it("falls back to navigator.standalone for iOS home-screen apps", () => {
    mockDisplayModes();
    expect(isStandalone()).toBe(false);
    setNavigatorStandalone(true);
    expect(isStandalone()).toBe(true);
  });

  it("is false in a browser tab", () => {
    mockDisplayModes("browser");
    expect(isStandalone()).toBe(false);
  });
});

describe("applyDisplayMode", () => {
  it("locks zoom out of the installed app", () => {
    mockDisplayModes("standalone");
    const meta = viewportMeta();

    applyDisplayMode();

    expect(document.documentElement.dataset.displayMode).toBe("standalone");
    expect(meta.getAttribute("content")).toContain("user-scalable=no");
    expect(meta.getAttribute("content")).toContain("maximum-scale=1.0");
    // The safe-area opt-in has to survive the rewrite, or the notch reclaims
    // the top of every screen.
    expect(meta.getAttribute("content")).toContain("viewport-fit=cover");
  });

  it("leaves a browser tab able to zoom", () => {
    mockDisplayModes("browser");
    const meta = viewportMeta();

    applyDisplayMode();

    expect(document.documentElement.dataset.displayMode).toBe("browser");
    expect(meta.getAttribute("content")).not.toContain("user-scalable");
    expect(meta.getAttribute("content")).not.toContain("maximum-scale");
  });
});

describe("watchDisplayMode", () => {
  it("blocks iOS pinch gestures while installed, and only while installed", () => {
    mockDisplayModes("browser");
    viewportMeta();
    disposers.push(watchDisplayMode());
    expect(pinch().defaultPrevented).toBe(false);

    // Installing from an open tab moves the live document into the installed
    // window without a reload — the media-query change is the only signal.
    mockDisplayModes("standalone");
    for (const listener of [...listeners]) listener();
    expect(pinch().defaultPrevented).toBe(true);

    mockDisplayModes("browser");
    for (const listener of [...listeners]) listener();
    expect(pinch().defaultPrevented).toBe(false);
  });

  it("stops blocking once disposed", () => {
    mockDisplayModes("standalone");
    viewportMeta();
    const dispose = watchDisplayMode();
    expect(pinch().defaultPrevented).toBe(true);

    dispose();
    expect(pinch().defaultPrevented).toBe(false);
  });
});
