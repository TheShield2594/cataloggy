import { useEffect, useState } from "react";

/**
 * Whether the page has scrolled past `threshold` pixels.
 *
 * For the nav bar, which is transparent while the page is at the top and
 * materialises — tint, blur, hairline — once content has passed under it. That
 * is the platform's large-title bar: at rest there is no chrome at all, and the
 * bar only appears when there is something for it to separate itself from.
 *
 * Cheap enough to run on every scroll event because it is a boolean: the
 * listener is passive and it only calls `setState` on the two frames where the
 * answer actually changes, so a page scrolled a thousand pixels re-renders the
 * shell twice.
 *
 * The initial read happens in an effect rather than in the initialiser: the
 * shell renders before the router has restored a scroll position, and a bar
 * that decided it was transparent at mount would stay that way over content.
 */
export function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const read = () => setScrolled(window.scrollY > threshold);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [threshold]);

  return scrolled;
}
