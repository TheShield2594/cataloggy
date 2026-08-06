import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useVisualViewport } from "./useVisualViewport";

type FakeViewport = {
  offsetTop: number;
  offsetLeft: number;
  width: number;
  height: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  emit: (type: string) => void;
};

function installViewport(initial: { offsetTop?: number; offsetLeft?: number; width?: number; height?: number }) {
  const listeners = new Map<string, Set<() => void>>();
  const vv: FakeViewport = {
    offsetTop: initial.offsetTop ?? 0,
    offsetLeft: initial.offsetLeft ?? 0,
    width: initial.width ?? 390,
    height: initial.height ?? 844,
    addEventListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    emit: (type) => {
      act(() => {
        listeners.get(type)?.forEach((listener) => listener());
      });
    },
  };
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true, writable: true });
  return { vv, listenerCount: (type: string) => listeners.get(type)?.size ?? 0 };
}

function Overlay({ active }: { active?: boolean }) {
  const style = useVisualViewport(active);
  return <div data-testid="overlay" className="fixed inset-0" style={style} />;
}

describe("useVisualViewport", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "visualViewport");
  });

  it("leaves the element's own classes in charge where the API is missing", () => {
    render(<Overlay />);
    expect(screen.getByTestId("overlay").getAttribute("style")).toBe(null);
  });

  it("pins the overlay to the visible slice of the screen", () => {
    installViewport({ height: 844, width: 390 });
    render(<Overlay />);
    expect(screen.getByTestId("overlay")).toHaveStyle({ top: "0px", left: "0px", width: "390px", height: "844px" });
  });

  it("follows the keyboard: shrinks and moves with the visual viewport", () => {
    const { vv } = installViewport({ height: 844 });
    render(<Overlay />);

    // What an on-screen keyboard does — the layout viewport is unchanged, so
    // `100vh` would still claim the full 844 and run on behind the keyboard.
    vv.height = 380;
    vv.offsetTop = 120;
    vv.emit("resize");

    expect(screen.getByTestId("overlay")).toHaveStyle({ top: "120px", height: "380px" });
  });

  it("tracks the viewport being scrolled under a fixed overlay", () => {
    const { vv } = installViewport({ height: 400, offsetTop: 0 });
    render(<Overlay />);

    vv.offsetTop = 64;
    vv.emit("scroll");

    expect(screen.getByTestId("overlay")).toHaveStyle({ top: "64px" });
  });

  it("lets go of the last measurement when it is switched off", () => {
    installViewport({ height: 380, offsetTop: 120 });
    const { rerender } = render(<Overlay active />);
    expect(screen.getByTestId("overlay")).toHaveStyle({ height: "380px" });

    // Nothing updates the geometry once the listeners are gone, so keeping it
    // would hand the caller a keyboard-sized overlay with no keyboard.
    rerender(<Overlay active={false} />);
    // React empties the properties it set but leaves the attribute behind, so
    // this asks what the element is actually styled with.
    expect(screen.getByTestId("overlay").style.height).toBe("");
    expect(screen.getByTestId("overlay").style.top).toBe("");

    rerender(<Overlay active />);
    expect(screen.getByTestId("overlay")).toHaveStyle({ height: "380px" });
  });

  it("measures nothing while inactive, and stops listening on unmount", () => {
    const { listenerCount } = installViewport({ height: 844 });

    const closed = render(<Overlay active={false} />);
    expect(screen.getByTestId("overlay").getAttribute("style")).toBe(null);
    expect(listenerCount("resize")).toBe(0);
    closed.unmount();

    const open = render(<Overlay active />);
    expect(listenerCount("resize")).toBe(1);
    open.unmount();
    expect(listenerCount("resize")).toBe(0);
    expect(listenerCount("scroll")).toBe(0);
  });
});
