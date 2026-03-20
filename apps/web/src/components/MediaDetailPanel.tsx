import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, Clock, Film, Star, Tv, X } from "lucide-react";
import { api, ApiError, CatalogList, MediaType, SearchResult, WatchEvent } from "../api";

/* ─── Star Rating Component ───────────────────────────────── */

export function StarRating({
  imdbId,
  type,
  onError,
}: {
  imdbId: string;
  type: MediaType;
  onError?: (message: string) => void;
}) {
  const [userRating, setUserRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setUserRating(null);
    setHoverRating(null);
    setLoaded(false);
    setLoadError(null);
    let canceled = false;
    void (async () => {
      try {
        const res = await api.getRating(type, imdbId);
        if (!canceled) setUserRating(res.rating.rating);
      } catch (err) {
        if (!canceled) {
          if (err instanceof ApiError && err.status === 404) {
            // no rating — leave null
          } else {
            setLoadError(err instanceof Error ? err.message : "Failed to load rating");
          }
        }
      } finally {
        if (!canceled) setLoaded(true);
      }
    })();
    return () => { canceled = true; };
  }, [imdbId, type]);

  const handleRate = async (rating: number) => {
    if (saving) return;
    if (userRating === rating) {
      setSaving(true);
      try {
        await api.deleteRating(type, imdbId);
        setUserRating(null);
        setHoverRating(null);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Failed to remove rating");
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    try {
      const res = await api.setRating(imdbId, type, rating);
      setUserRating(res.rating.rating);
      setHoverRating(null);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to save rating");
    } finally {
      setSaving(false);
    }
  };

  const retryLoadRating = useCallback(() => {
    setLoadError(null);
    setLoaded(false);
    void (async () => {
      try {
        const res = await api.getRating(type, imdbId);
        setUserRating(res.rating.rating);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // no rating
        } else {
          setLoadError(err instanceof Error ? err.message : "Failed to load rating");
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, [imdbId, type]);

  if (!loaded) {
    return <div className="skeleton h-8 w-40 rounded-lg" />;
  }

  const displayRating = hoverRating ?? userRating ?? 0;

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <Star className="h-3.5 w-3.5" />
        Your Rating
      </h3>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
          <button
            key={star}
            type="button"
            disabled={saving}
            onClick={() => void handleRate(star)}
            onMouseEnter={() => setHoverRating(star)}
            onMouseLeave={() => setHoverRating(null)}
            className="p-0.5 transition-transform hover:scale-125 disabled:opacity-50"
            aria-label={`Rate ${star} out of 10`}
          >
            <Star
              className={`h-5 w-5 transition-colors ${
                star <= displayRating
                  ? "fill-amber-400 text-amber-400"
                  : "text-slate-600 hover:text-slate-500"
              }`}
            />
          </button>
        ))}
        {userRating !== null && (
          <span className="ml-2 text-sm font-semibold text-amber-400">{userRating}/10</span>
        )}
      </div>
      {loadError && (
        <p className="mt-1 flex items-center gap-2 text-xs text-rose-400">
          {loadError}
          <button type="button" onClick={retryLoadRating} className="underline hover:text-rose-300">Retry</button>
        </p>
      )}
    </div>
  );
}

/* ─── Detail Panel ────────────────────────────────────────── */

export function DetailPanel({
  item,
  history,
  historyLoading,
  listMap,
  onClose,
  onShowToast,
}: {
  item: SearchResult;
  history: WatchEvent[];
  historyLoading: boolean;
  listMap: Map<string, CatalogList>;
  onClose: () => void;
  onShowToast: (message: string, type: "success" | "error" | "info") => void;
}) {
  const listNames = item.lists
    .map((id) => listMap.get(id)?.name)
    .filter(Boolean) as string[];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-slate-800/60 bg-slate-950 shadow-2xl sm:w-[28rem]">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/80 text-slate-400 backdrop-blur hover:bg-slate-800 hover:text-white transition-colors"
          aria-label="Close detail panel"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Poster */}
        <div className="relative w-full" style={{ aspectRatio: "2 / 3", maxHeight: "50vh" }}>
          {item.poster ? (
            <img
              src={item.poster}
              alt={item.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
              <Film className="h-20 w-20 text-slate-700" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
        </div>

        {/* Content */}
        <div className="-mt-16 relative z-10 flex-1 space-y-6 px-6 pb-8">
          {/* Title area */}
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide ${
                  item.type === "movie"
                    ? "bg-red-500/90 text-white"
                    : "bg-violet-600/90 text-white"
                }`}
              >
                {item.type === "movie" ? <Film className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                {item.type === "movie" ? "Movie" : "Series"}
              </span>
              {item.year && <span className="text-sm text-slate-400">{item.year}</span>}
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white">{item.name}</h2>
            {((item.rating != null && item.rating > 0) || item.genres.length > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {item.rating != null && item.rating > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-400 ring-1 ring-amber-500/20">
                    <Star className="h-3 w-3 fill-amber-400" />
                    {item.rating.toFixed(1)}
                  </span>
                )}
                {item.genres.slice(0, 4).map((g) => (
                  <span key={g} className="rounded-full bg-slate-800/80 px-2.5 py-1 text-xs text-slate-400">{g}</span>
                ))}
              </div>
            )}
          </div>

          {/* Lists */}
          {listNames.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {listNames.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20"
                >
                  <Check className="h-3 w-3" />
                  {name}
                </span>
              ))}
            </div>
          )}

          {/* User Rating */}
          <StarRating imdbId={item.imdbId} type={item.type} onError={(msg) => onShowToast(msg, "error")} />

          {/* Description */}
          {item.description && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Overview</h3>
              <p className="text-sm leading-relaxed text-slate-300">{item.description}</p>
            </div>
          )}

          {/* Watch History */}
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              Watch History
            </h3>
            {historyLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-11 rounded-lg" />
                ))}
              </div>
            ) : history.length === 0 ? (
              <p className="rounded-xl bg-slate-900/60 border border-slate-800/40 py-5 text-center text-sm text-slate-500">
                No watch history yet
              </p>
            ) : (
              <div className="space-y-1.5">
                {history.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 rounded-lg bg-slate-900/60 border border-slate-800/30 px-3 py-2.5"
                  >
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                    <div className="min-w-0 flex-1">
                      {event.season != null && event.episode != null ? (
                        <span className="text-sm text-slate-200">
                          S{String(event.season).padStart(2, "0")}:E
                          {String(event.episode).padStart(2, "0")}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-200">Watched</span>
                      )}
                    </div>
                    <time className="shrink-0 text-2xs text-slate-500">
                      {new Date(event.watchedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </time>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

/* ─── Hook: open panel with history loading ───────────────── */

export function useDetailPanel() {
  const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
  const [panelHistory, setPanelHistory] = useState<WatchEvent[]>([]);
  const [panelHistoryLoading, setPanelHistoryLoading] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedItem(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!selectedItem) return;
    setPanelHistoryLoading(true);
    void (async () => {
      try {
        const history = await api.getWatchHistory(50);
        setPanelHistory(history.filter((e) => e.imdbId === selectedItem.imdbId));
      } catch {
        setPanelHistory([]);
      } finally {
        setPanelHistoryLoading(false);
      }
    })();
  }, [selectedItem]);

  return { selectedItem, setSelectedItem, panelHistory, panelHistoryLoading };
}
