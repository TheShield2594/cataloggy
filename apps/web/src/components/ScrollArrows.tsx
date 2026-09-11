import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The previous/next cluster that sits beside a horizontal rail's heading.
 *
 * Written twice — once on the dashboard and once inside the cast rail — at two
 * sizes, with the same fade-when-there-is-nothing-to-scroll trick and the same
 * `aria-hidden` gate implemented separately. The cast copy had drifted: no
 * focus ring, and 24px buttons with no touch target around them.
 */

type Size = "sm" | "md";

/**
 * Button diameter, and the gap that goes with it on a touch screen.
 *
 * `.tap-target` grows each button's hit area to 44px without moving anything,
 * which means it overhangs by `(44 - size) / 2` per side. Two neighbours whose
 * overhangs meet inside the gap hand the whole strip to whichever comes later
 * in the DOM, so the coarse-pointer gap is `44 - size`: exactly enough for the
 * two areas to meet at the boundary and no further. A mouse keeps the tighter
 * cluster, which is what lets the row share a line with its heading.
 */
const SIZES: Record<Size, { button: string; icon: string; coarseGap: string }> = {
  sm: { button: "h-6 w-6", icon: "h-3.5 w-3.5", coarseGap: "[@media(pointer:coarse)]:gap-5" },
  md: { button: "h-8 w-8", icon: "h-4 w-4", coarseGap: "[@media(pointer:coarse)]:gap-3" },
};

export function ScrollArrows({
  canScrollLeft,
  canScrollRight,
  onScroll,
  size = "md",
  subject,
}: {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  onScroll: (dir: "left" | "right") => void;
  /** `sm` inside a panel, `md` for a page-level section heading. */
  size?: Size | undefined;
  /** Named in the labels — "Scroll cast left". Omit for a bare "Scroll left". */
  subject?: string | undefined;
}) {
  const scrollable = canScrollLeft || canScrollRight;
  const { button, icon, coarseGap } = SIZES[size];
  const label = (direction: "left" | "right") =>
    subject ? `Scroll ${subject} ${direction}` : `Scroll ${direction}`;

  return (
    // Stays mounted when the row fits on screen so a resize fades the cluster
    // out instead of blinking it away; disabled buttons keep it untabbable.
    <div
      className={`flex items-center gap-1.5 ${coarseGap} transition-opacity duration-slow ${scrollable ? "" : "pointer-events-none opacity-0"}`}
      aria-hidden={!scrollable}
    >
      {(["left", "right"] as const).map((direction) => (
        <button
          key={direction}
          type="button"
          onClick={() => onScroll(direction)}
          disabled={direction === "left" ? !canScrollLeft : !canScrollRight}
          className={`tap-target flex ${button} items-center justify-center rounded-full transition-all duration-base disabled:opacity-30 disabled:cursor-default active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset`}
          style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)", color: "var(--text-dim)" }}
          aria-label={label(direction)}
        >
          {direction === "left" ? <ChevronLeft className={icon} /> : <ChevronRight className={icon} />}
        </button>
      ))}
    </div>
  );
}
