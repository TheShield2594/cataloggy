import type { ReactNode } from "react";
import { PosterCard } from "../PosterCard";
import { POSTER_CARD_FILL_SIZES, POSTER_CARD_SIZES } from "../Poster";
import { formatRating, ratingLabel } from "../../utils/rating";

// `?: T | undefined` rather than `?: T`: every caller forwards a value that is
// already optional, and a missing prop and an undefined one are the same thing
// to React and to everything below. The distinction the flag exists for is
// made where it is real — a Prisma `data`, a `fetch` init, a Fastify option.
export type DiscoveryItem = {
  id: string;
  name: string;
  poster?: string | undefined;
  rating?: number | undefined;
  genres?: string[] | undefined;
  year?: number | undefined;
  type?: string | undefined;
  description?: string | undefined;
};

/** A poster card in a discovery rail: the artwork, its score, and what it is. */
export function DiscoveryCard({ item, badge, reason, onSelect, eager, fill }: {
  item: DiscoveryItem;
  badge?: ReactNode | undefined;
  reason?: string | undefined;
  onSelect?: ((item: DiscoveryItem) => void) | undefined;
  eager?: boolean | undefined;
  /** Fills the width of a grid cell instead of using a fixed carousel-card width. */
  fill?: boolean | undefined;
}) {
  return (
    <PosterCard
      poster={item.poster}
      name={item.name}
      {...(onSelect ? { onOpen: () => onSelect(item) } : {})}
      eager={eager}
      sizes={fill ? POSTER_CARD_FILL_SIZES : POSTER_CARD_SIZES}
      className={fill ? "w-full" : "w-poster-card flex-none"}
      overlay={
        <>
          {item.rating != null && item.rating > 0 && (
            // 28px of chip has no room for "/10", so the scale lives in the
            // accessible name and the tooltip instead of being left implied.
            <div
              role="img"
              aria-label={ratingLabel(item.rating)}
              title={ratingLabel(item.rating)}
              className="absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 backdrop-blur-sm"
              style={{ boxShadow: "0 0 0 1.5px rgba(245,158,11,0.7)" }}
            >
              {/* Fixed amber rather than --status-warn — the badge is on a black
                  scrim over poster art, not on a theme surface, and the token
                  goes dark on the light theme. Same pairing as the Stats page's
                  rating badges. */}
              <span aria-hidden="true" className="meta font-bold text-[#f5c451]">{formatRating(item.rating)}</span>
            </div>
          )}
          {badge && <div className="absolute top-2 right-2">{badge}</div>}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/55 to-transparent px-3 pb-2.5 pt-10 opacity-100 transition-opacity duration-base sm:opacity-0 sm:group-hover:opacity-100">
            <p className="truncate text-xs font-semibold text-white">{item.name}</p>
          </div>
        </>
      }
    >
      <p className="mt-2.5 truncate text-sm font-semibold text-[var(--text)] transition-colors group-hover:text-claw-text">
        {item.name}
      </p>
      <p className="meta-row truncate" style={{ color: "var(--text-dim)" }}>
        {item.year ?? ""}
        {item.type ? ` · ${item.type === "movie" ? "Movie" : "Series"}` : ""}
        {item.genres && item.genres.length > 0 ? ` · ${item.genres.slice(0, 2).join(", ")}` : ""}
      </p>
      {reason && (
        <p className="mt-0.5 line-clamp-2 text-2xs italic leading-snug" style={{ color: "var(--text-dim)" }} title={reason}>
          {reason}
        </p>
      )}
    </PosterCard>
  );
}
