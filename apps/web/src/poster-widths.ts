/*
 * TMDB's poster width ladder, and the two operations both readers of it need.
 *
 * Two places have to agree on this list:
 *
 *  - `components/Poster.tsx`, which turns it into a `srcset` so a 112px slot
 *    downloads a 112px-ish file instead of the w500 the API stored.
 *  - `sw.js`, which caches what that `srcset` asks for, and has to recognise
 *    two widths of one poster as two views of the same picture.
 *
 * Kept apart they drifted in the way that matters: the worker's poster cache is
 * capped at 400 entries, and a title shown as a 28px history thumbnail, a 192px
 * card and a 304px shelf hero occupies three of them. The cap counts URLs, so
 * the number of *titles* that survive offline is a fraction of what it reads.
 */

/**
 * TMDB's actual poster steps, ascending.
 *
 * Starts at w92 because several surfaces render posters around 112px wide — at
 * 1x those were being served a w185 and downscaled, roughly four times the
 * bytes for no visible difference.
 */
export const TMDB_SRCSET_WIDTHS = [92, 154, 185, 342, 500, 780] as const;

/**
 * TMDB serves the same image at fixed widths under `/t/p/<size>/<path>`, so the
 * size segment is the only part that differs between two renditions of one
 * poster.
 */
const TMDB_IMAGE_RE = /^(https:\/\/image\.tmdb\.org\/t\/p\/)w(\d+)(\/.+)$/;

/** A TMDB image URL split at its width segment. */
export type SizedTmdbImage = {
  /** Everything up to and including `/t/p/`. */
  prefix: string;
  /** The width the URL asks for, in pixels. */
  width: number;
  /** The path from the slash after the size segment onward. */
  path: string;
};

/** Splits a TMDB image URL at its width segment, or `null` if it isn't one. */
export function parseSizedTmdbImage(href: string): SizedTmdbImage | null {
  const match = href.match(TMDB_IMAGE_RE);
  if (!match) return null;
  return { prefix: match[1], width: Number(match[2]), path: match[3] };
}

/** The same picture at another rung of the ladder. */
export function tmdbImageAtWidth(image: SizedTmdbImage, width: number): string {
  return `${image.prefix}w${width}${image.path}`;
}
