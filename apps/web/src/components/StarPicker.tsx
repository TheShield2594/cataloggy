import { useRef, useState } from "react";
import { Star } from "lucide-react";
import { STARS_MAX, formatStars } from "../utils/rating";

/**
 * Five stars, half a star at a time — the shape every rating the user sets is
 * drawn in, whether it's a film, a season, an episode or a game.
 *
 * `value` and `onRate` speak the stored 1-10 scale rather than stars, because
 * that is what the API takes and what Trakt, IMDb and TMDB all rate on. Half
 * stars are what make the two scales the same thing: five stars in half steps
 * is ten values, so `stored / 2` converts without rounding and no rating loses
 * precision on the way in or out.
 *
 * Each star carries two invisible buttons over its halves. That keeps the ten
 * values individually clickable and announceable — a single slider would be
 * smaller in markup but would lose the "click your current rating to clear it"
 * gesture the panels rely on.
 *
 * Only one of the ten is in the tab order at a time, with the arrow keys moving
 * between them: a seasons list holds a picker per season and per episode, and
 * ten tab stops apiece would put hundreds of them between the top of the panel
 * and anything below it.
 *
 * The cell a star is drawn in is wider than the star. Two buttons split a cell,
 * so a cell narrower than 48px puts both of them under the 24x24 SC 2.5.8 asks
 * of a pointer target — the 28px star this used measured 14x28 per half, and
 * 10x20 at the mobile `md` size. Ten targets in a row can't fall back on the
 * spacing exception either, since each one's neighbour is the thing crowding
 * it. So the cell is fixed at 48px wide and the glyph is centred in it at
 * whatever size the caller asked for; the extra width lands between stars,
 * where it reads as air rather than as bigger stars.
 *
 * Cells are 48px wide at both sizes, which makes the whole row 240px. That is
 * wider than a dense episode row can spare beside a title, so the rows that
 * hold a `sm` picker wrap it onto its own line when it doesn't fit.
 */
export function StarPicker({
  value,
  onRate,
  disabled = false,
  size = "md",
  subject,
}: {
  /** The stored rating, 1-10, or null when unrated. */
  value: number | null;
  /** Called with the stored 1-10 value. Called with the current value when the user picks it again, which the caller treats as "clear". */
  onRate: (value: number) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Names what is being rated in the accessible label, e.g. "Season 3". */
  subject?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const shown = hover ?? value ?? 0;
  // The one button that carries the tab stop: whichever holds the rating, or
  // the first when there isn't one yet.
  const activeValue = value ?? 1;

  const moveFocus = (from: number, delta: number) => {
    const next = Math.min(STARS_MAX * 2, Math.max(1, from + delta));
    if (next === from) return;
    buttonsRef.current[next - 1]?.focus();
  };
  // The glyph, unchanged in size.
  const starClass = size === "sm" ? "h-4 w-4" : "h-5 w-5 sm:h-7 sm:w-7";
  // The cell the glyph is centred in, and the two half-buttons split. 48px wide
  // so each half clears 24px; height is the glyph's, floored at 24px.
  const boxClass = size === "sm" ? "h-6 w-12" : "h-8 w-12";

  const half = (index: number, side: 0 | 1) => index * 2 + side + 1;

  return (
    // No gap: a gap between cells is dead space between two targets, and the
    // cells are already wide enough to separate the stars visually.
    <div className="flex flex-none items-center" onMouseLeave={() => setHover(null)}>
      {Array.from({ length: STARS_MAX }, (_, i) => {
        // 0, 0.5 or 1 of this star's width, for both the committed rating and
        // the hover preview — a preview below the saved rating has to empty the
        // stars above the pointer, or nothing shows what the click would do.
        const fill = Math.max(0, Math.min(1, (shown - i * 2) / 2));
        const committedFill = Math.max(0, Math.min(1, ((value ?? 0) - i * 2) / 2));
        const popping = committedFill > 0 && fill >= committedFill;

        return (
          <span key={i} className={`relative grid flex-none place-items-center ${boxClass}`}>
            {/* Glyph-sized, and the clipping context for the fill below. The
                cell is wider than the star now, so a fill measured against the
                cell would put "half a star" 24px from the cell's edge — which
                is short of the glyph's own midpoint. */}
            <span className={`relative grid place-items-center ${starClass}`}>
              <Star className={`absolute ${starClass}`} style={{ color: "var(--text-mute)" }} />
              {fill > 0 && (
                <span
                  className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden"
                  style={{ width: `${fill * 100}%` }}
                >
                  <Star
                    className={`star-shake-target absolute left-0 top-0 fill-warning text-warning ${starClass} ${popping ? "star-pop" : ""}`}
                  />
                </span>
              )}
            </span>
            {([0, 1] as const).map((side) => {
              const target = half(i, side);
              const stars = formatStars(target);
              const isCurrent = value === target;
              return (
                <button
                  key={side}
                  ref={(node) => {
                    buttonsRef.current[target - 1] = node;
                  }}
                  type="button"
                  disabled={disabled}
                  tabIndex={target === activeValue ? 0 : -1}
                  onClick={() => onRate(target)}
                  onMouseEnter={() => setHover(target)}
                  onFocus={() => setHover(target)}
                  onBlur={() => setHover(null)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                      event.preventDefault();
                      moveFocus(target, 1);
                    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                      event.preventDefault();
                      moveFocus(target, -1);
                    }
                  }}
                  // Half the cell, which is 24px of the 48 — the SC 2.5.8
                  // minimum, and the reason the cell is that wide.
                  //
                  // The ring matters more here than on a labelled control: the
                  // buttons are transparent, so without it the only sign of
                  // keyboard focus is the fill preview `onFocus` sets, which
                  // looks exactly like a hover.
                  className={`absolute inset-y-0 ${side === 0 ? "left-0" : "right-0"} w-1/2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus disabled:cursor-not-allowed`}
                  // The current rating's button does the opposite of every
                  // other one — it clears the rating — and saying so only in
                  // `title` leaves out screen readers and touch users entirely.
                  aria-label={
                    isCurrent
                      ? `${subject ? `${subject}: ` : "Your rating: "}${stars} out of ${STARS_MAX}. Activate to remove it`
                      : `Rate ${subject ? `${subject} ` : ""}${stars} out of ${STARS_MAX}`
                  }
                  aria-pressed={isCurrent}
                  title={isCurrent ? "Click again to remove your rating" : undefined}
                />
              );
            })}
          </span>
        );
      })}
      <span
        className={`ml-1.5 font-semibold tabular-nums text-warning ${size === "sm" ? "text-2xs" : "text-xs sm:text-sm"}`}
      >
        {shown > 0 ? `${formatStars(shown)}/${STARS_MAX}` : ""}
      </span>
    </div>
  );
}
