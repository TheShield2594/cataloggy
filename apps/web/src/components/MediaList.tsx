import { Plus, Film, Tv } from "lucide-react";
import { CatalogMeta } from "../api";

type Props = {
  title: string;
  items: CatalogMeta[];
  count?: number;
  onSeeAll?: () => void;
  onAddItem?: (item: CatalogMeta) => void;
};

export function MediaList({ title, items, count, onSeeAll, onAddItem }: Props) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">
          {title}
          {count !== undefined && (
            <span className="ml-2 text-sm font-normal text-slate-500">({count})</span>
          )}
        </h2>
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
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No items yet.</p>
      ) : (
        <div className="flex overflow-x-auto gap-4 pb-2 snap-x snap-mandatory scrollbar-hide">
          {items.map((item) => (
            <div
              key={`${item.type}:${item.id}`}
              className="group relative flex-none snap-start"
            >
              <div className="card-lift relative h-44 w-[7.5rem] overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10">
                {/* Type badge */}
                <span className="absolute top-2 left-2 z-10 rounded-md bg-slate-950/80 px-1.5 py-0.5 text-2xs font-semibold text-slate-200 backdrop-blur-sm">
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
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                    <Film className="h-8 w-8 text-slate-600" />
                  </div>
                )}

                {/* Hover overlay */}
                {onAddItem && (
                  <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300 pb-3">
                    <button
                      type="button"
                      onClick={() => onAddItem(item)}
                      className="rounded-full bg-red-500 p-2 text-white shadow-lg hover:bg-red-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                      aria-label={`Add ${item.name}`}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-2 w-[7.5rem] truncate text-sm font-medium text-slate-200">{item.name}</p>
              {item.year ? <p className="w-[7.5rem] text-2xs text-slate-500">{item.year}</p> : null}
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
        <div key={i} className="flex-none">
          <div className="skeleton h-44 w-[7.5rem] rounded-xl" />
          <div className="skeleton mt-2 h-3.5 w-20 rounded" />
          <div className="skeleton mt-1 h-3 w-12 rounded" />
        </div>
      ))}
    </div>
  );
}
