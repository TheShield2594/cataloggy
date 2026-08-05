import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Poster } from "../Poster";
import { CarouselTrack } from "../CarouselTrack";
import { useHorizontalScroll } from "../carousel-utils";
import type { TrendingMeta } from "../../api";
import { KICKER } from "../typography";

export function RecommendationsSection({
  items, loading, onSelect,
}: {
  items: TrendingMeta[];
  loading: boolean;
  onSelect: (item: TrendingMeta) => void;
}) {
  const { ref, canScrollLeft, canScrollRight, scroll } = useHorizontalScroll();

  if (loading) {
    return (
      <div>
        <h3 className={`mb-3 flex items-center gap-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>
          <Sparkles className="h-3.5 w-3.5" /> More Like This
        </h3>
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-none space-y-1.5" style={{ width: "7rem" }}>
              <div className="skeleton aspect-poster rounded-lg" />
              <div className="skeleton h-2.5 w-full rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`flex items-center gap-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>
          <Sparkles className="h-3.5 w-3.5" /> More Like This
        </h3>
        {/* Mounted even when the row fits, so the cluster fades with layout
            changes instead of blinking; disabled buttons keep it untabbable. */}
        <div
          className={`flex items-center gap-1 transition-opacity duration-300 ${canScrollLeft || canScrollRight ? "" : "pointer-events-none opacity-0"}`}
          aria-hidden={!canScrollLeft && !canScrollRight}
        >
          <button
            type="button"
            onClick={() => scroll("left")}
            disabled={!canScrollLeft}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:cursor-default active:scale-95"
            style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)", color: "var(--text-dim)" }}
            aria-label="Scroll recommendations left"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => scroll("right")}
            disabled={!canScrollRight}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:cursor-default active:scale-95"
            style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)", color: "var(--text-dim)" }}
            aria-label="Scroll recommendations right"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <CarouselTrack
        scrollRef={ref}
        canScrollLeft={canScrollLeft}
        canScrollRight={canScrollRight}
        className="gap-3"
      >
        {items.map((item) => (
          <button
            key={`${item.type}:${item.id}`}
            type="button"
            onClick={() => onSelect(item)}
            className="group flex-none text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
            style={{ width: "7rem" }}
            aria-label={`View details for ${item.name}`}
          >
            <div
              className="relative aspect-poster overflow-hidden rounded-lg shadow-lg transition-all duration-300 group-hover:scale-[1.03]"
              style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}
            >
              <Poster src={item.poster} alt={item.name} className="h-full w-full" sizes="112px" />
            </div>
            <p className="mt-1.5 truncate text-2xs font-medium leading-tight text-[var(--text-dim)] transition-colors group-hover:text-claw-text">
              {item.name}
            </p>
          </button>
        ))}
      </CarouselTrack>
    </div>
  );
}
