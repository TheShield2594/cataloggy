import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/* ─── Poster fallback helpers ─── */

export const FALLBACK_GRADIENTS = [
  "from-rose-900 to-slate-900",
  "from-violet-900 to-slate-900",
  "from-blue-900 to-slate-900",
  "from-emerald-900 to-slate-900",
  "from-amber-900 to-slate-900",
  "from-cyan-900 to-slate-900",
  "from-fuchsia-900 to-slate-900",
  "from-orange-900 to-slate-900",
];

export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/[\s:–—-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function getGradient(name: string | null | undefined): string {
  if (!name) return FALLBACK_GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_GRADIENTS[Math.abs(hash) % FALLBACK_GRADIENTS.length];
}

/* ─── Horizontal scroll hook ─── */

export function useHorizontalScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const setRef = useCallback((el: HTMLDivElement | null) => {
    (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    setNode(el);
  }, []);

  const checkScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = node;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    const observer = new ResizeObserver(checkScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      observer.disconnect();
    };
  }, [node, checkScroll]);

  const scroll = useCallback((direction: "left" | "right") => {
    const el = ref.current;
    if (!el) return;
    const amount = el.clientWidth * 0.75;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: reduceMotion ? "auto" : "smooth" });
  }, []);

  return { ref: setRef, canScrollLeft, canScrollRight, scroll, checkScroll };
}

/* ─── Edge fade mask for horizontally scrollable carousels ─── */

/**
 * Fades the edges of a scrollable row toward the direction it can still scroll,
 * so clipped cards read as "more content" instead of a hard cut. No-op (fully
 * opaque) once a given direction runs out of content.
 */
export function fadeMaskStyle(canScrollLeft: boolean, canScrollRight: boolean): CSSProperties {
  if (!canScrollLeft && !canScrollRight) return {};
  const left = canScrollLeft ? "transparent 0, black 32px" : "black 0";
  const right = canScrollRight ? "black calc(100% - 32px), transparent 100%" : "black 100%";
  const image = `linear-gradient(to right, ${left}, ${right})`;
  return { maskImage: image, WebkitMaskImage: image };
}
