import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  FALLBACK_GRADIENTS,
  fadeMaskStyle,
  getGradient,
  getInitials,
  useHorizontalScroll,
} from "./carousel-utils";

describe("getInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(getInitials("Breaking Bad")).toBe("BB");
    expect(getInitials("The Lord of the Rings")).toBe("TL");
  });

  it("uppercases single-word titles", () => {
    expect(getInitials("severance")).toBe("S");
  });

  it("splits on colons and every dash variant", () => {
    expect(getInitials("Star Wars: A New Hope")).toBe("SW");
    expect(getInitials("Spider-Man")).toBe("SM");
    expect(getInitials("Mission–Impossible")).toBe("MI");
    expect(getInitials("Mission—Impossible")).toBe("MI");
  });

  it("ignores separators that would otherwise yield empty initials", () => {
    expect(getInitials("  -  Fargo")).toBe("F");
  });

  it("falls back to '?' for missing names", () => {
    expect(getInitials(null)).toBe("?");
    expect(getInitials(undefined)).toBe("?");
    expect(getInitials("")).toBe("?");
  });
});

describe("getGradient", () => {
  it("always returns one of the known gradients", () => {
    for (const name of ["Dune", "Arrival", "Andor", "Chernobyl", "Fleabag"]) {
      expect(FALLBACK_GRADIENTS).toContain(getGradient(name));
    }
  });

  it("is stable for the same name", () => {
    expect(getGradient("Succession")).toBe(getGradient("Succession"));
  });

  it("spreads different names across more than one gradient", () => {
    const names = ["Dune", "Arrival", "Andor", "Chernobyl", "Fleabag", "Barry", "Severance"];
    expect(new Set(names.map(getGradient)).size).toBeGreaterThan(1);
  });

  it("uses the first gradient for missing names", () => {
    expect(getGradient(null)).toBe(FALLBACK_GRADIENTS[0]);
    expect(getGradient("")).toBe(FALLBACK_GRADIENTS[0]);
  });

  it("stays in range for names whose hash overflows to a negative int", () => {
    const long = "x".repeat(500);
    expect(FALLBACK_GRADIENTS).toContain(getGradient(long));
  });
});

describe("fadeMaskStyle", () => {
  it("applies no mask when the row fits entirely on screen", () => {
    expect(fadeMaskStyle(false, false)).toEqual({});
  });

  it("fades only the right edge at the start of a scrollable row", () => {
    const style = fadeMaskStyle(false, true);
    expect(style.maskImage).toBe(
      "linear-gradient(to right, black 0, black calc(100% - 32px), transparent 100%)"
    );
    expect(style.WebkitMaskImage).toBe(style.maskImage);
  });

  it("fades only the left edge at the end of a scrollable row", () => {
    expect(fadeMaskStyle(true, false).maskImage).toBe(
      "linear-gradient(to right, transparent 0, black 32px, black 100%)"
    );
  });

  it("fades both edges mid-scroll", () => {
    expect(fadeMaskStyle(true, true).maskImage).toBe(
      "linear-gradient(to right, transparent 0, black 32px, black calc(100% - 32px), transparent 100%)"
    );
  });
});

/** jsdom has no layout, so scroll metrics have to be faked onto the node. */
function scrollableDiv({ scrollLeft = 0, scrollWidth = 1000, clientWidth = 400 } = {}) {
  const el = document.createElement("div");
  Object.defineProperties(el, {
    scrollLeft: { value: scrollLeft, writable: true, configurable: true },
    scrollWidth: { value: scrollWidth, writable: true, configurable: true },
    clientWidth: { value: clientWidth, writable: true, configurable: true },
  });
  document.body.append(el);
  return el;
}

describe("useHorizontalScroll", () => {
  it("reports no scrollability before a node is attached", () => {
    const { result } = renderHook(() => useHorizontalScroll());
    expect(result.current.canScrollLeft).toBe(false);
    expect(result.current.canScrollRight).toBe(false);
  });

  it("detects room to scroll right once attached to an overflowing row", () => {
    const el = scrollableDiv();
    const { result } = renderHook(() => useHorizontalScroll());

    act(() => result.current.ref(el));

    expect(result.current.canScrollLeft).toBe(false);
    expect(result.current.canScrollRight).toBe(true);
  });

  it("updates both directions as the row is scrolled", () => {
    const el = scrollableDiv();
    const { result } = renderHook(() => useHorizontalScroll());
    act(() => result.current.ref(el));

    el.scrollLeft = 300;
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.canScrollLeft).toBe(true);
    expect(result.current.canScrollRight).toBe(true);

    el.scrollLeft = 600;
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.canScrollLeft).toBe(true);
    expect(result.current.canScrollRight).toBe(false);
  });

  it("ignores sub-pixel scroll offsets on either end", () => {
    const el = scrollableDiv({ scrollLeft: 3 });
    const { result } = renderHook(() => useHorizontalScroll());
    act(() => result.current.ref(el));

    expect(result.current.canScrollLeft).toBe(false);

    el.scrollLeft = 597;
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.canScrollRight).toBe(false);
  });

  it("scrolls by three quarters of the visible width in each direction", () => {
    const el = scrollableDiv();
    const scrollBy = vi.fn();
    el.scrollBy = scrollBy;
    const { result } = renderHook(() => useHorizontalScroll());
    act(() => result.current.ref(el));

    act(() => result.current.scroll("right"));
    expect(scrollBy).toHaveBeenCalledWith({ left: 300, behavior: "smooth" });

    act(() => result.current.scroll("left"));
    expect(scrollBy).toHaveBeenCalledWith({ left: -300, behavior: "smooth" });
  });

  it("jumps without animation when the user prefers reduced motion", () => {
    const el = scrollableDiv();
    const scrollBy = vi.fn();
    el.scrollBy = scrollBy;
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);

    const { result } = renderHook(() => useHorizontalScroll());
    act(() => result.current.ref(el));
    act(() => result.current.scroll("right"));

    expect(scrollBy).toHaveBeenCalledWith({ left: 300, behavior: "auto" });
  });

  it("stops listening once the node is detached", () => {
    const el = scrollableDiv();
    const remove = vi.spyOn(el, "removeEventListener");
    const { result } = renderHook(() => useHorizontalScroll());
    act(() => result.current.ref(el));

    act(() => result.current.ref(null));

    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
