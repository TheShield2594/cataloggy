import type { ReactNode } from "react";
import { Poster, POSTER_GRID_SIZES } from "./Poster";

/**
 * The frame a poster sits in, and the one action a poster card has.
 *
 * Seven of these were written separately — Discover, Search, Games, Lists,
 * Stats, and two on the Shelf — and they had drifted on every axis the markup
 * has: the aspect ratio came from `var(--poster-ratio)` in some and a literal
 * `"2/3"` in others, the hover was `card-lift` or `group-hover:scale-[1.03]` or
 * nothing, and three of them rendered a raw `<img>`, which meant no shimmer
 * while the image loaded and no initials when it failed.
 *
 * What is shared is only the frame: a 2:3 clipped box with the artwork in it,
 * and the full-card button that opens the thing. Everything a page actually
 * cares about — a quick-add menu, hours played, a progress ruler, a rank — is
 * its own, and goes in `overlay` (inside the frame) or `children` (under it).
 */
export function PosterCard({
  poster,
  name,
  onOpen,
  openLabel,
  eager = false,
  sizes = POSTER_GRID_SIZES,
  hover = true,
  overlay,
  actions,
  className = "",
  children,
}: {
  poster: string | null | undefined;
  /** Used as the poster's alt text and, by default, in the button's label. */
  name: string;
  /** Omit for a card that is not itself a button — one whose actions are inside it. */
  onOpen?: (() => void) | undefined;
  /** Defaults to "View details for <name>". */
  openLabel?: string | undefined;
  eager?: boolean | undefined;
  sizes?: string | undefined;
  /** The frame lifts slightly on hover. Off for a card inside a dense list. */
  hover?: boolean | undefined;
  /** Badges and scrims, positioned against the frame — and clipped by it. */
  overlay?: ReactNode | undefined;
  /**
   * Controls that sit over the poster but must not be clipped by it: a
   * quick-add button whose menu opens past the edge, a remove button whose
   * focus ring is drawn outside. They land in a box the size of the frame, so
   * `bottom-3` means the bottom of the poster and not of the whole card.
   *
   * The box takes no clicks, so that the full-card button underneath still
   * receives them; each control inside has to say `pointer-events-auto` for
   * itself.
   */
  actions?: ReactNode | undefined;
  /** Extra classes for the outer wrapper — a fixed width, a flex rule. */
  className?: string | undefined;
  /** The caption under the frame. */
  children?: ReactNode | undefined;
}) {
  return (
    <div className={`group relative rounded-xl ${className}`.trimEnd()}>
      {/* A real button rather than a `role="button"` div: it inherits Enter and
          Space, the disabled and active semantics, and the announcement
          assistive tech expects, instead of re-implementing the first and
          forgoing the rest. It stretches over the whole card because the card
          is one action — anything that needs its own sits above it in `overlay`
          with a higher z-index.

          `overflow-hidden` belongs to the frame below, not here, so the poster's
          hover scale is clipped without also clipping this button's focus ring,
          which is drawn outside the card's edge. */}
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={openLabel ?? `View details for ${name}`}
          className="absolute inset-0 z-10 cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset"
        />
      )}
      <div
        className={`poster-frame relative aspect-poster overflow-hidden rounded-xl${hover ? " group-hover:scale-[1.03]" : ""}`}
      >
        <Poster src={poster ?? undefined} alt={name} className="h-full w-full" eager={eager} sizes={sizes} />
        {overlay}
      </div>
      {actions && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 aspect-poster">{actions}</div>
      )}
      {children}
    </div>
  );
}
