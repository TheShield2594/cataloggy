import type { ReactNode } from "react";

/**
 * The grid a page of posters sits in.
 *
 * The column counts were a class string copied seven times across Search,
 * Games, Lists, the Shelf and Stats, which is seven places for a breakpoint to
 * drift — and they had already drifted into three different densities with
 * nothing recording that any of it was deliberate. The three are kept, and
 * named for what each is actually for.
 */

export type PosterGridDensity = "page" | "library" | "compact";

const DENSITIES: Record<PosterGridDensity, string> = {
  /** A results or list page: big enough to read a title under the poster. */
  page: "grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
  /**
   * The Shelf. Three across on a phone rather than two: a poster is
   * recognisable well below the width two-up gives it, and three is what turns
   * the grid into a *library* — a shelf of them at once instead of a stack you
   * scroll through a pair at a time.
   */
  library:
    "grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 sm:gap-x-4 sm:gap-y-5",
  /** Inside a panel, where the grid is an illustration rather than the subject. */
  compact: "grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5",
};

export function PosterGrid({
  density = "page",
  className = "",
  children,
}: {
  density?: PosterGridDensity | undefined;
  /** Layout that belongs to the caller — a top margin, say — not to the grid. */
  className?: string | undefined;
  children: ReactNode;
}) {
  return <div className={`grid ${DENSITIES[density]} ${className}`.trimEnd()}>{children}</div>;
}
