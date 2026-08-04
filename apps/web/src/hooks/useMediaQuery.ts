import { useEffect, useState } from "react";

/**
 * Live `matchMedia` result for `query`.
 *
 * Responsive *styling* belongs in CSS. This is for the cases where the
 * breakpoint decides what React renders at all — a layout that has no useful
 * small-screen form, rather than one that merely looks different.
 */
export function useMediaQuery(query: string): boolean {
  const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [matches, setMatches] = useState(() => (supported ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (!supported) return;
    const list = window.matchMedia(query);
    // Re-read on subscribe: the query can have changed, and the match can have
    // flipped between the initial render and this effect.
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query, supported]);

  return matches;
}
