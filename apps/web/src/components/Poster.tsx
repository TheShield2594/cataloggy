import { useEffect, useState } from "react";
import { getGradient, getInitials } from "./carousel-utils";

// TMDB serves the same image at fixed widths under /t/p/<size>/<path>.
// Swapping the size segment lets us request a smaller file for small
// layouts instead of always downloading the original w500 the API stores.
const TMDB_IMAGE_RE = /^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+(\/.+)$/;
const TMDB_SRCSET_WIDTHS = [185, 342, 500, 780];

function buildTmdbSrcSet(src: string): string | undefined {
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
      onError={() => setLoadFailed(true)}
    />
  );
}
