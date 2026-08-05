import { useState } from "react";
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
 * values individually clickable, focusable and announceable — a single slider
 * would be smaller in markup but would lose the "click your current rating to
 * clear it" gesture the panels rely on.
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

  const shown = hover ?? value ?? 0;
  const starClass = size === "sm" ? "h-4 w-4" : "h-5 w-5 sm:h-7 sm:w-7";
  const boxClass = size === "sm" ? "h-4 w-4" : "h-5 w-5 sm:h-7 sm:w-7";

  const half = (index: number, side: 0 | 1) => index * 2 + side + 1;

  return (
    <div className="flex items-center gap-0 sm:gap-0.5" onMouseLeave={() => setHover(null)}>
      {Array.from({ length: STARS_MAX }, (_, i) => {
        // 0, 0.5 or 1 of this star's width, for both the committed rating and
        // the hover preview — a preview below the saved rating has to empty the
        // stars above the pointer, or nothing shows what the click would do.
        const fill = Math.max(0, Math.min(1, (shown - i * 2) / 2));
        const committedFill = Math.max(0, Math.min(1, ((value ?? 0) - i * 2) / 2));
        const popping = committedFill > 0 && fill >= committedFill;

        return (
          <span key={i} className={`relative grid flex-none place-items-center ${boxClass}`}>
            <Star className={`absolute ${starClass}`} style={{ color: "var(--text-mute)" }} />
            {fill > 0 && (
              <span
                className="pointer-events-none absolute inset-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <span className={`grid place-items-center ${boxClass}`}>
                  <Star
                    className={`star-shake-target absolute fill-amber-400 text-amber-400 ${starClass} ${popping ? "star-pop" : ""}`}
                  />
                </span>
              </span>
            )}
            {([0, 1] as const).map((side) => {
              const target = half(i, side);
              const stars = formatStars(target);
              const isCurrent = value === target;
              return (
                <button
                  key={side}
                  type="button"
                  disabled={disabled}
                  onClick={() => onRate(target)}
                  onMouseEnter={() => setHover(target)}
                  onFocus={() => setHover(target)}
                  onBlur={() => setHover(null)}
                  className={`absolute inset-y-0 ${side === 0 ? "left-0" : "right-0"} w-1/2 disabled:cursor-not-allowed`}
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
        className={`ml-1.5 font-semibold tabular-nums text-amber-500 ${size === "sm" ? "text-2xs" : "text-xs sm:text-sm"}`}
      >
        {shown > 0 ? `${formatStars(shown)}/${STARS_MAX}` : ""}
      </span>
    </div>
  );
}
