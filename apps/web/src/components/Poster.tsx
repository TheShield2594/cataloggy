import { useEffect, useState } from "react";
import { getGradient, getInitials } from "./carousel-utils";

// TMDB serves the same image at fixed widths under /t/p/<size>/<path>.
// Swapping the size segment lets us request a smaller file for small
// layouts instead of always downloading the original w500 the API stores.
const TMDB_IMAGE_RE = /^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+(\/.+)$/;
// TMDB's actual poster steps. The list starts at w92 because several surfaces
// render posters around 112px wide — at 1x those were being served a w185 and
// downscaled, which is roughly four times the bytes for no visible difference.
const TMDB_SRCSET_WIDTHS = [92, 154, 185, 342, 500, 780];

/** Default `sizes` for the poster grids, which share a layout across pages. */
export const POSTER_GRID_SIZES = "(min-width: 640px) 220px, 45vw";

/**
 * Exported for the pages that render their own `<img>` rather than this
 * component — their placeholder markup differs, but the bytes on the wire
 * shouldn't. Without a srcset they pull whatever width the API stored (usually
 * w500) into a slot around 180px wide.
 */
export function buildTmdbSrcSet(src: string): string | undefined {
  const match = src.match(TMDB_IMAGE_RE);
  if (!match) return undefined;
  const [, base, rest] = match;
  return TMDB_SRCSET_WIDTHS.map((w) => `${base}w${w}${rest} ${w}w`).join(", ");
}

export function Poster({
  src,
  alt,
  className = "",
  eager = false,
  sizes = "(min-width: 640px) 220px, 45vw",
}: {
  src?: string;
  alt: string | null | undefined;
  className?: string;
  eager?: boolean;
  /** `sizes` attribute matching this poster's actual rendered width, so the browser picks the right srcset entry. */
  sizes?: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => { setLoadFailed(false); }, [src]);

  if (!src || loadFailed) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br ${getGradient(alt)} ${className}`}>
        <span className="text-xl font-bold text-white/60 select-none">
          {getInitials(alt)}
        </span>
      </div>
    );
  }

  const srcSet = buildTmdbSrcSet(src);

  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt ?? "Poster"}
      className={`object-cover ${className}`}
      loading={eager ? "eager" : "lazy"}
      decoding={eager ? "sync" : "async"}
      // Above-fold artwork is what the page looks like — it should outrank the
      // lazy posters further down the row that the browser would otherwise treat
      // as equals. `low` on the rest keeps them behind the data requests.
      fetchPriority={eager ? "high" : "low"}
      onError={() => setLoadFailed(true)}
    />
  );
}
