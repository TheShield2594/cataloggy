import { Plus, Film, Tv } from "lucide-react";
import { CatalogMeta } from "../api";

type Props = {
  title: string;
  items: CatalogMeta[];
  count?: number;
  onSeeAll?: () => void;
};

export function MediaList({ title, items, count, onSeeAll }: Props) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold font-heading">
          {title}
          {count !== undefined && (
            <span className="ml-2 text-sm font-normal text-slate-400">({count})</span>
          )}
        </h2>
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="text-sm text-sky-400 hover:text-sky-300"
          >
            See all &rarr;
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">No items yet.</p>
      ) : (
        <div className="flex overflow-x-auto gap-3 pb-2 snap-x snap-mandatory scrollbar-hide">
          {items.map((item) => (
            <div
              key={`${item.type}:${item.id}`}
              className="group relative flex-none snap-start"
            >
              <div className="relative h-40 w-28 overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10">
                {/* Type badge */}
                <span className="absolute top-1.5 left-1.5 z-10 rounded-full bg-slate-900/80 px-1.5 py-0.5 text-2xs font-medium text-slate-200 backdrop-blur">
                  {item.type === "movie" ? (
                    <span className="flex items-center gap-0.5"><Film className="h-2.5 w-2.5" /> Movie</span>
                  ) : (
                    <span className="flex items-center gap-0.5"><Tv className="h-2.5 w-2.5" /> Series</span>
                  )}
                </span>

                {item.poster ? (
                  <img
                    src={item.poster}
                    alt={`${item.name} poster`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-slate-700">
                    <Film className="h-8 w-8 text-slate-500" />
                  </div>
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pb-2">
                  <button
                    type="button"
                    className="rounded-full bg-sky-500 p-1.5 text-white shadow-lg hover:bg-sky-400"
                    aria-label={`Add ${item.name}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="mt-1.5 w-28 truncate text-xs font-medium text-slate-200">{item.name}</p>
              {item.year ? <p className="w-28 text-2xs text-slate-500">{item.year}</p> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden pb-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex-none">
          <div className="skeleton h-40 w-28 rounded-xl" />
          <div className="skeleton mt-1.5 h-3 w-20 rounded" />
          <div className="skeleton mt-1 h-2.5 w-12 rounded" />
        </div>
      ))}
    </div>
  );
}
