import { Sparkles } from "lucide-react";
import type { TrendingMeta } from "../../api";
import { CarouselTrack } from "../CarouselTrack";
import type { useHorizontalScroll } from "../carousel-utils";
import { ScrollArrows } from "../ScrollArrows";
import { SectionError } from "../SectionError";
import { KICKER } from "../typography";
import { CarouselSkeleton } from "./CarouselSkeleton";
import { DiscoveryCard, type DiscoveryItem } from "./DiscoveryCard";

/** One labelled rail (Movies / Series) within the shared Discover section. */
export function DiscoverSubRow({
  label,
  loading,
  failed,
  onRetry,
  items,
  reasons,
  aiActive,
  scroll,
  onSelect,
}: {
  label: string;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  items: TrendingMeta[];
  reasons: Record<string, string>;
  aiActive: boolean;
  scroll: ReturnType<typeof useHorizontalScroll>;
  onSelect: (item: DiscoveryItem) => void;
}) {
  if (!loading && !failed && items.length === 0) return null;
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className={KICKER} style={{ color: "var(--text-mute)" }}>{label}</h3>
        {!loading && !failed && items.length > 0 && (
          <ScrollArrows canScrollLeft={scroll.canScrollLeft} canScrollRight={scroll.canScrollRight} onScroll={scroll.scroll} />
        )}
      </div>
      {failed && !loading ? (
        <SectionError message={`Couldn't load ${label.toLowerCase()} recommendations.`} onRetry={onRetry} />
      ) : loading ? (
        aiActive
          ? <p className="text-sm italic" style={{ color: "var(--text-dim)" }}>Generating AI recommendations...</p>
          : <CarouselSkeleton />
      ) : (
        <CarouselTrack
          scrollRef={scroll.ref}
          canScrollLeft={scroll.canScrollLeft}
          canScrollRight={scroll.canScrollRight}
          className="gap-4"
        >
          {items.map((item) => (
            <DiscoveryCard
              key={item.id}
              item={item}
              reason={reasons[item.id]}
              onSelect={onSelect}
              badge={
                <span className="inline-flex items-center gap-1 rounded-md bg-plum-500/80 px-1.5 py-0.5 text-2xs font-semibold text-white backdrop-blur-sm">
                  <Sparkles className="h-2.5 w-2.5" />
                  {aiActive && <span>AI</span>}
                </span>
              }
            />
          ))}
        </CarouselTrack>
      )}
    </div>
  );
}
