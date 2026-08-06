import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

type ViewportRect = { top: number; left: number; width: number; height: number };

function readViewport(): ViewportRect | null {
  const vv = typeof window === "undefined" ? undefined : window.visualViewport;
  if (!vv) return null;
  return { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height };
}

function sameRect(a: ViewportRect | null, b: ViewportRect | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/**
 * Styles that pin a `position: fixed` overlay to the part of the screen the
 * user can actually see.
 *
 * `100vh` — and `inset-0` on a fixed element, which resolves the same way — is
 * the *layout* viewport: on iOS it keeps its full height when the on-screen
 * keyboard appears, so a modal sized against it runs on underneath the
 * keyboard, and because Safari then scrolls the visual viewport to keep the
 * focused input in view, the modal's header scrolls off the top at the same
 * time. The result is a search dialog with no visible search field and a result
 * list cut off at both ends. `visualViewport` is the one measurement that
 * describes what's left over, and it moves with the keyboard.
 *
 * Returns `undefined` where the API is missing (jsdom, older browsers), leaving
 * whatever the element's classes say — which is correct anywhere the layout and
 * visual viewports agree.
 */
export function useVisualViewport(active = true): CSSProperties | undefined {
  const [rect, setRect] = useState<ViewportRect | null>(() => (active ? readViewport() : null));

  useEffect(() => {
    if (!active) {
      // Drop the last measurement rather than keeping geometry nothing is
      // updating any more — a caller that reactivates gets a fresh one below.
      setRect(null);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    // Keyboard animations fire a burst of these; bailing when nothing moved
    // keeps the overlay from re-rendering on every frame of one.
    const update = () => setRect((prev) => {
      const next = readViewport();
      return sameRect(prev, next) ? prev : next;
    });

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);

  // `active` as well as `rect`: the render that turns the hook off comes before
  // the effect that clears the measurement.
  if (!active || !rect) return undefined;
  // `top`/`left` + `width`/`height` beat the `inset-0` these sit on: an
  // over-constrained box drops `right`/`bottom`, so no `auto` overrides needed.
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}
