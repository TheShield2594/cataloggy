import type { ReactNode } from "react";

/**
 * A horizontally scrollable row whose edges fade toward whichever direction it
 * can still scroll, so a clipped card reads as "more content" rather than a hard
 * cut.
 *
 * The fade is two overlaid gradients rather than a `mask-image` on the scroll
 * container. A mask erases the pixels it covers, so a card sitting against a
 * scrollable edge lost its `focus-visible` ring entirely — invisible focus,
 * exactly where the row is hardest to read. The overlay dims the same pixels
 * without removing them, so the ring still reads through the fade.
 *
 * Two details go with it:
 *  - `scroll-px-8` matches the fade width, so when the browser scrolls a focused
 *    card into view it stops 32px short of the edge — clear of the fade rather
 *    than under it. (Chromium leaves an already-partly-visible card where it is
 *    on Tab; that case is why the ring has to survive the fade at all.)
 *  - The track carries `p-2` against a `-m-2` wrapper: the same position on the
 *    page, plus 8px of room inside the scroll container's own clip box, which
 *    `overflow-x: auto` clips vertically as well as horizontally. 8px covers
 *    every decoration in play — the 4px `card-lift` translate, the ~2px a
 *    `scale-[1.03]` poster gains, and a 2px ring at a 2px offset.
 *
 * Both fades stay mounted and toggle opacity instead of mounting on demand —
 * reaching an end of the row eases the fade out over 300ms rather than
 * blinking it away on the frame the scroll position crosses the threshold.
 *
 * The track snaps with `snap-proximity` (via `snap-start` on each child):
 * a flick that ends near a card boundary settles on it instead of stopping
 * mid-card, while `proximity` — unlike `mandatory` — leaves free scrolling
 * through the middle of a long row alone. `scroll-px-8` doubles as the snap
 * padding, so a snapped card lands clear of the fade.
 */
export function CarouselTrack({
  scrollRef,
  canScrollLeft,
  canScrollRight,
  className = "",
  fadeColor = "var(--bg-0)",
  children,
}: {
  scrollRef: (el: HTMLDivElement | null) => void;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  /** Extra classes for the scrolling track — the row's `gap`, typically. */
  className?: string;
  /** The colour the edges fade into; must match what sits behind the row. */
  fadeColor?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative -m-2">
      <div
        ref={scrollRef}
        className={`flex overflow-x-auto scroll-smooth scroll-px-8 snap-x snap-proximity [&>*]:snap-start scrollbar-hide p-2 ${className}`}
      >
        {children}
      </div>
      <EdgeFade side="left" color={fadeColor} visible={canScrollLeft} />
      <EdgeFade side="right" color={fadeColor} visible={canScrollRight} />
    </div>
  );
}

function EdgeFade({ side, color, visible }: { side: "left" | "right"; color: string; visible: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-carousel-fade={side}
      className={`pointer-events-none absolute inset-y-0 w-8 transition-opacity duration-300 ${side === "left" ? "left-0" : "right-0"} ${visible ? "opacity-100" : "opacity-0"}`}
      style={{ background: `linear-gradient(to ${side === "left" ? "right" : "left"}, ${color}, transparent)` }}
    />
  );
}
