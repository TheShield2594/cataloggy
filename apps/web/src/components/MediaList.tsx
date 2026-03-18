import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Film, Tv, ChevronLeft, ChevronRight } from "lucide-react";
import { CatalogMeta } from "../api";

/* ─── Poster fallback helpers ─── */

const FALLBACK_GRADIENTS = [
  "from-rose-900 to-slate-900",
  "from-violet-900 to-slate-900",
  "from-blue-900 to-slate-900",
  "from-emerald-900 to-slate-900",
  "from-amber-900 to-slate-900",
  "from-cyan-900 to-slate-900",
  "from-fuchsia-900 to-slate-900",
  "from-orange-900 to-slate-900",
];

function getInitials(name: string): string {
  return name
    .split(/[\s:–—-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function getGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_GRADIENTS[Math.abs(hash) % FALLBACK_GRADIENTS.length];
}

/* ─── Scroll hook ─── */

function useHorizontalScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    const observer = new ResizeObserver(checkScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      observer.disconnect();
    };
  }, [checkScroll]);

  const scroll = useCallback((direction: "left" | "right") => {
    const el = ref.current;
    if (!el) return;
    const amount = el.clientWidth * 0.75;
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  }, []);

  return { ref, canScrollLeft, canScrollRight, scroll, checkScroll };
}

type Props = {
  title: string;
  items: CatalogMeta[];
  count?: number;
  onSeeAll?: () => void;
  onAddItem?: (item: CatalogMeta) => void;
};

export function MediaList({ title, items, count, onSeeAll, onAddItem }: Props) {
  const { ref, canScrollLeft, canScrollRight, scroll, checkScroll } = useHorizontalScroll();

  // Re-check after items load
  useEffect(() => {
    setTimeout(checkScroll, 50);
  }, [items, checkScroll]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-white">
            {title}
          </h2>
          {count !== undefined && (
            <span className="rounded-full bg-slate-800/80 px-2.5 py-0.5 text-xs font-medium text-slate-400 tabular-nums">
              {count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => scroll("left")}
                disabled={!canScrollLeft}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700/60 bg-slate-900/80 text-slate-400 transition-all hover:border-slate-600 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:cursor-default"
                aria-label="Scroll left"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => scroll("right")}
                disabled={!canScrollRight}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700/60 bg-slate-900/80 text-slate-400 transition-all hover:border-slate-600 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:cursor-default"
                aria-label="Scroll right"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          {onSeeAll && (
            <button
              type="button"
              onClick={onSeeAll}
              className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
            >
              See all &rarr;
            </button>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 py-12 text-center">
          <Film className="mx-auto h-10 w-10 text-slate-700" />
          <p className="mt-3 text-sm text-slate-500">No items yet.</p>
        </div>
      ) : (
        <div
          ref={ref}
          className="flex overflow-x-auto gap-4 pb-2 scroll-smooth scrollbar-hide"
        >
          {items.map((item) => (
            <div
              key={`${item.type}:${item.id}`}
              className="group relative flex-none"
              style={{ width: "11rem" }}
            >
              <div className="relative overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10 transition-all duration-300 group-hover:shadow-card-hover group-hover:ring-white/20" style={{ aspectRatio: "2 / 3" }}>
                {/* Type badge */}
                <span className="absolute top-2.5 left-2.5 z-10 rounded-md bg-black/70 px-1.5 py-0.5 text-2xs font-semibold text-white backdrop-blur-sm">
                  {item.type === "movie" ? (
                    <span className="flex items-center gap-1"><Film className="h-2.5 w-2.5" /> Movie</span>
                  ) : (
                    <span className="flex items-center gap-1"><Tv className="h-2.5 w-2.5" /> Series</span>
                  )}
                </span>

                {item.poster ? (
                  <img
                    src={item.poster}
                    alt={`${item.name} poster`}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${getGradient(item.name)}`}>
                    <span className="text-2xl font-bold text-white/40 select-none">
                      {getInitials(item.name)}
                    </span>
                  </div>
                )}

                {/* Hover overlay */}
                {onAddItem && (
                  <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300 pb-4">
                    <button
                      type="button"
                      onClick={() => onAddItem(item)}
                      className="rounded-full bg-red-500 p-2.5 text-white shadow-lg hover:bg-red-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                      aria-label={`Add ${item.name}`}
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-2.5 truncate text-sm font-semibold text-slate-200">{item.name}</p>
              {item.year ? <p className="text-2xs text-slate-500">{item.year}</p> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-4 overflow-hidden pb-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex-none" style={{ width: "11rem" }}>
          <div className="skeleton rounded-xl" style={{ aspectRatio: "2 / 3" }} />
          <div className="skeleton mt-2.5 h-4 w-24 rounded" />
          <div className="skeleton mt-1.5 h-3 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}
