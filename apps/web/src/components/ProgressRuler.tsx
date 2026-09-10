/*
 * One grid, four rulers.
 *
 * Merging shows, films and games onto a single shelf costs precision unless
 * each kind keeps its own unit. A show is watched in episodes — discrete,
 * countable, and "4 of 8" is a fact the viewer can act on. A game is played in
 * hours, which are continuous and have no natural total. A film has no parts at
 * all. Drawing all three as the same percentage bar is what makes a unified
 * list read as a flattening: the bar says "62%" for a show whose real state is
 * "two episodes left this season", and says nothing at all for a film.
 *
 * So there is one component and two shapes:
 *
 *   ticks  one segment per episode, the watched ones filled, the one in flight
 *          part-filled. Used when the total is a countable number of parts and
 *          small enough that a segment stays wider than the gap beside it.
 *   bar    a single continuous fill. Used for hours, pages, and for a series so
 *          long that ticks would be slivers.
 *
 * A film gets neither — the caller renders nothing rather than an empty bar.
 */

/**
 * Above this, ticks stop being readable: at the 12rem poster width a 24-part
 * row already puts each segment at about 6px, which is three times the 2px gap
 * beside it. A 60-episode series drawn the same way is a dotted line, so it
 * takes the continuous bar instead — the precision the ticks were protecting is
 * gone at that length anyway.
 */
export const TICK_CEILING = 24;

export type ProgressRulerProps = {
  /** Whole units finished — episodes watched, chapters cleared, pages read. */
  value: number;
  /** Units in the whole, so `value / total` is the fill. */
  total: number;
  /**
   * How far into unit `value + 1` the viewer is, 0–1. Drawn as a part-filled
   * tick, and folded into the bar's width when the ruler falls back to one.
   * Omitted wherever the app has no partial-play signal, which is most places.
   */
  partial?: number;
  /**
   * Whether the units are countable parts. Episodes and chapters are; hours and
   * pages are not, even though both arrive here as two numbers.
   */
  discrete?: boolean;
  /**
   * What the ruler is measuring, for anyone who can't see it — "Season 3, 4 of
   * 8 episodes watched". Required unless `decorative`, because a bare
   * progressbar announces a percentage and no subject.
   */
  label?: string;
  /**
   * Set where the same numbers are already written out in text beside the
   * ruler. The ruler then leaves the accessibility tree entirely rather than
   * announcing the row's progress a second time in a different wording.
   */
  decorative?: boolean;
  /**
   * How heavy the ruler is drawn. `sm` (3px) is the default and what a card or
   * a row takes; `md` (5px) is for a detail screen, where the ruler is the
   * subject of its section rather than a caption under a title.
   */
  size?: "sm" | "md";
  className?: string;
};

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

export function ProgressRuler({
  value,
  total,
  partial = 0,
  discrete = false,
  label,
  decorative = false,
  size = "sm",
  className = "",
}: ProgressRulerProps) {
  // Nothing to measure against. A ruler with no total is a full-width empty
  // track, which reads as "0% done" rather than as "unknown" — so draw nothing
  // and let the row's mono metadata carry whatever is actually known.
  if (!Number.isFinite(total) || total <= 0) return null;

  const whole = Math.min(Math.max(Math.floor(value), 0), total);
  // A partial unit past the last whole one only exists if there is a unit left
  // to be part-way through.
  const part = whole < total ? clamp01(partial) : 0;
  const fraction = clamp01((whole + part) / total);

  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({
        role: "progressbar" as const,
        "aria-label": label,
        "aria-valuemin": 0,
        "aria-valuemax": total,
        // The whole units, not the fraction: "4" is what the row says in text
        // and what the viewer would say out loud. The part-filled tick is a
        // visual refinement, not a fifth episode.
        "aria-valuenow": whole,
        "aria-valuetext": label,
      } as const);

  const thickness = size === "md" ? "5px" : "3px";

  if (discrete && total <= TICK_CEILING) {
    return (
      // 3px of gap rather than 2. A tick row is read as a count before it is
      // read as a proportion, and the gap is what makes it countable — at 2px
      // a ten-episode season on a 300px card reads as one broken line.
      <div {...a11y} className={`flex items-center gap-[3px] ${className}`}>
        {Array.from({ length: total }, (_, i) => {
          // `i` counts from 0, `whole` counts units: tick 0 is the first
          // episode, so it is filled once one episode is watched.
          const filled = i < whole;
          const current = i === whole && part > 0;
          return (
            <span
              key={i}
              className="flex-1 overflow-hidden rounded-[2px]"
              style={{
                height: thickness,
                background: filled ? "rgb(var(--accent-rgb))" : "var(--border-strong)",
              }}
            >
              {/* The tick in flight. Drawn as a child fill rather than as a
                  third background colour so it uses the same accent as the
                  finished ticks — a half-watched episode is the same state as a
                  watched one, just less of it. */}
              {current && (
                <span
                  className="block h-full rounded-[2px] transition-[width] duration-slow ease-out"
                  style={{ width: `${part * 100}%`, background: "rgb(var(--accent-rgb))" }}
                />
              )}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div
      {...a11y}
      className={`w-full overflow-hidden rounded-full ${className}`}
      style={{ height: thickness, background: "var(--border-strong)" }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-slow ease-out"
        style={{ width: `${fraction * 100}%`, background: "rgb(var(--accent-rgb))" }}
      />
    </div>
  );
}
