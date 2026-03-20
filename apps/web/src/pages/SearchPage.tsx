import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Clock, Film, Plus, Search, Star, Tv, X, Heart } from "lucide-react";
import { api, ApiError, CatalogList, MediaType, SearchResult, WatchEvent } from "../api";

type FilterType = "all" | MediaType;

/* ─── Toast System ─── */

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 sm:bottom-6 max-sm:bottom-20 max-sm:right-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-enter flex items-center gap-3 rounded-xl border bg-slate-900 px-5 py-3.5 shadow-xl ${
            toast.type === "success"
              ? "border-emerald-500/30"
              : toast.type === "error"
                ? "border-rose-500/30"
                : "border-red-500/30"
          }`}
          style={{ borderLeftWidth: "4px" }}
        >
          {toast.type === "success" ? (
            <Check aria-hidden="true" className="h-5 w-5 flex-none text-emerald-400" />
          ) : toast.type === "error" ? (
            <X aria-hidden="true" className="h-5 w-5 flex-none text-rose-400" />
          ) : (
            <Heart aria-hidden="true" className="h-5 w-5 flex-none text-red-400" />
          )}
          <span className="text-sm font-medium text-slate-200">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

type Toast = { id: number; message: string; type: "success" | "error" | "info" };
let toastId = 0;

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [lists, setLists] = useState<CatalogList[]>([]);
  const [pendingAdds, setPendingAdds] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
  const [panelHistory, setPanelHistory] = useState<WatchEvent[]>([]);
  const [panelHistoryLoading, setPanelHistoryLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  // Load lists on mount
  useEffect(() => {
    void (async () => {
      try {
        const { lists: loaded } = await api.getLists();
        setLists(loaded);
      } catch (err) {
        console.error(err);
        showToast(err instanceof Error ? err.message : "Failed to load lists", "error");
      }
    })();
  }, [showToast]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close side panel on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedItem(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Load watch history when side panel opens
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

  const listMap = useMemo(() => {
    const map = new Map<string, CatalogList>();
    for (const l of lists) map.set(l.id, l);
    return map;
  }, [lists]);

  const doSearch = useCallback(
    async (searchFilter: FilterType, searchQuery: string) => {
      if (!searchQuery.trim()) return;
      setIsSearching(true);

      try {
        if (searchFilter === "all") {
          const [movies, series] = await Promise.all([
            api.search("movie", searchQuery),
            api.search("series", searchQuery),
          ]);
          // Interleave: movie, series, movie, series...
          const merged: SearchResult[] = [];
          const maxLen = Math.max(movies.length, series.length);
          for (let i = 0; i < maxLen; i++) {
            if (i < movies.length) merged.push(movies[i]);
            if (i < series.length) merged.push(series[i]);
          }
          setResults(merged);
        } else {
          const response = await api.search(searchFilter, searchQuery);
          setResults(response);
        }
      } catch (err) {
        setResults([]);
        showToast(err instanceof Error ? err.message : "Search failed", "error");
      } finally {
        setIsSearching(false);
      }
    },
    [showToast]
  );

  // Debounced auto-search (300ms)
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doSearch(filter, query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, filter, doSearch]);

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await doSearch(filter, query);
  };

  const handleAdd = async (listId: string, result: SearchResult) => {
    const key = `${listId}:${result.imdbId}`;
    if (pendingAdds[key]) return;

    setPendingAdds((current) => ({ ...current, [key]: true }));

    try {
      await api.addToList(listId, { type: result.type, imdbId: result.imdbId, title: result.name });
      const listName = listMap.get(listId)?.name ?? "list";
      showToast(`Added "${result.name}" to ${listName}`, "success");
      // Update local lists state to reflect the addition
      setLists((prev) =>
        prev.map((l) =>
          l.id === listId
            ? { ...l, itemCount: l.itemCount + 1 }
            : l
        )
      );
      // Update search results to include the new list
      setResults((prev) =>
        prev?.map((r) =>
          r.imdbId === result.imdbId ? { ...r, lists: [...r.lists, listId] } : r
        ) ?? null
      );
      setOpenDropdown(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Unable to add item", "error");
    } finally {
      setPendingAdds((current) => ({ ...current, [key]: false }));
    }
  };

  const filterOptions: { value: FilterType; label: string; icon?: typeof Film }[] = [
    { value: "all", label: "All" },
    { value: "movie", label: "Movies", icon: Film },
    { value: "series", label: "Series", icon: Tv },
  ];

  const hasSearched = results !== null;
  const noResults = hasSearched && results.length === 0;

  return (
    <div className="relative space-y-6">
      {/* Search bar */}
      <form
        onSubmit={submitSearch}
        className="sticky top-[76px] z-40 rounded-2xl border border-slate-800/60 bg-slate-900/90 p-4 backdrop-blur-xl shadow-lg"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies & TV shows..."
            className="w-full rounded-full border border-slate-700/60 bg-slate-950 py-3.5 pl-14 pr-12 text-base placeholder:text-slate-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/15 transition-all"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setResults(null); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-600 text-xs font-bold text-slate-950 hover:bg-slate-400 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter pills */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex rounded-full border border-slate-700/60 bg-slate-800/60 p-1">
            {filterOptions.map((opt) => {
              const Icon = opt.icon;
              const active = filter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFilter(opt.value)}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                    active
                      ? "bg-red-500 text-white shadow-lg shadow-red-500/25"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {opt.label}
                </button>
              );
            })}
          </div>
          {isSearching && (
            <span className="ml-auto flex items-center gap-2 text-sm text-slate-400">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
              Searching...
            </span>
          )}
        </div>
      </form>

      {/* Empty state – no search yet */}
      {!hasSearched && !isSearching && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-slate-900 ring-1 ring-slate-800">
            <Search className="h-14 w-14 text-slate-700" />
          </div>
          <p className="mt-6 text-2xl font-bold text-slate-100">Discover your next favorite</p>
          <p className="mt-2 max-w-sm text-slate-500">
            Search for movies and series to add them to your lists and track what you watch.
          </p>
        </div>
      )}

      {/* No results */}
      {noResults && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-900 ring-1 ring-slate-800">
            <Search className="h-12 w-12 text-slate-700" />
          </div>
          <p className="mt-5 text-lg font-semibold text-slate-300">No results found</p>
          <p className="mt-1 text-sm text-slate-500">Try a different search term or filter.</p>
        </div>
      )}

      {/* Results grid */}
      {hasSearched && results.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">{results.length} results</p>
          </div>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {results.map((result) => (
              <ResultCard
                key={`${result.type}:${result.imdbId}`}
                result={result}
                lists={lists}
                listMap={listMap}
                pendingAdds={pendingAdds}
                openDropdown={openDropdown}
                dropdownRef={dropdownRef}
                onToggleDropdown={(id) => setOpenDropdown(openDropdown === id ? null : id)}
                onAdd={handleAdd}
                onSelect={setSelectedItem}
              />
            ))}
          </div>
        </>
      )}

      {/* Detail side panel */}
      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          history={panelHistory}
          historyLoading={panelHistoryLoading}
          listMap={listMap}
          onClose={() => setSelectedItem(null)}
          onShowToast={showToast}
        />
      )}

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}

/* ─── Result Card ─────────────────────────────────────────── */

function ResultCard({
  result,
  lists,
  listMap,
  pendingAdds,
  openDropdown,
  dropdownRef,
  onToggleDropdown,
  onAdd,
  onSelect,
}: {
  result: SearchResult;
  lists: CatalogList[];
  listMap: Map<string, CatalogList>;
  pendingAdds: Record<string, boolean>;
  openDropdown: string | null;
  dropdownRef: React.RefObject<HTMLDivElement>;
  onToggleDropdown: (id: string) => void;
  onAdd: (listId: string, result: SearchResult) => Promise<void>;
  onSelect: (result: SearchResult) => void;
}) {
  const isOpen = openDropdown === result.imdbId;
  const listNames = result.lists
    .map((id) => listMap.get(id)?.name)
    .filter(Boolean) as string[];

  return (
    <div className="group flex flex-col">
      {/* Poster */}
      <div
        role="button"
        tabIndex={0}
        className="card-lift relative cursor-pointer overflow-hidden rounded-xl ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        style={{ aspectRatio: "var(--poster-ratio)" }}
        onClick={() => onSelect(result)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(result);
          }
        }}
        aria-label={`View details for ${result.name}`}
      >
        {result.poster ? (
          <img
            src={result.poster}
            alt={result.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
            <Film className="h-12 w-12 text-slate-600" />
          </div>
        )}

        {/* Type badge */}
        <span
          className={`absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide shadow-lg ${
            result.type === "movie"
              ? "bg-red-500/90 text-white"
              : "bg-violet-600/90 text-white"
          }`}
        >
          {result.type === "movie" ? <Film className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
          {result.type === "movie" ? "Movie" : "Series"}
        </span>

        {/* Hover gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {/* Quick-add button (bottom-right on hover) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleDropdown(result.imdbId);
          }}
          className="absolute bottom-3 right-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 shadow-lg transition-all duration-300 hover:bg-red-600 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          aria-label={`Add ${result.name} to a list`}
        >
          <Plus className="h-4 w-4" strokeWidth={3} />
        </button>

        {/* Watchlist indicator */}
        {listNames.length > 0 && (
          <div className="absolute top-2.5 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-red-500 shadow-lg">
            <Heart className="h-4 w-4 fill-white text-white" />
          </div>
        )}
      </div>

      {/* Quick-add dropdown */}
      {isOpen && (
        <div ref={dropdownRef} className="relative z-30 mt-1">
          <div className="absolute left-0 right-0 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900 shadow-2xl">
            <p className="border-b border-slate-800 px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
              Add to list
            </p>
            {lists.map((list) => {
              const already = result.lists.includes(list.id);
              const key = `${list.id}:${result.imdbId}`;
              const pending = pendingAdds[key];
              return (
                <button
                  key={list.id}
                  type="button"
                  disabled={already || pending}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onAdd(list.id, result);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-800 disabled:opacity-50"
                >
                  {already ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  <span className={already ? "text-slate-400" : "text-slate-200"}>{list.name}</span>
                  {already && <span className="ml-auto text-2xs text-slate-500">Added</span>}
                  {pending && (
                    <span className="ml-auto inline-block h-3 w-3 animate-spin rounded-full border border-red-500 border-t-transparent" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Title & metadata */}
      <div className="mt-3">
        <p className="truncate text-sm font-semibold text-slate-100">{result.name}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-xs text-slate-500">{result.year ?? "Unknown year"}</span>
          {result.rating != null && result.rating > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-amber-400">
              <Star className="h-3 w-3 fill-amber-400" />
              {result.rating.toFixed(1)}
            </span>
          )}
          {listNames.length > 0 && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-2xs font-medium text-slate-400" title={listNames.join(", ")}>
              In {listNames.join(", ")}
            </span>
          )}
        </div>
        {result.genres?.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {result.genres.slice(0, 3).map((g) => (
              <span key={g} className="rounded bg-slate-800/80 px-1.5 py-0.5 text-2xs text-slate-400">{g}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Star Rating Component ───────────────────────────────── */

function StarRating({
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
          // 404 = no rating exists, anything else is a real error
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
    // If clicking same rating, remove it
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

/* ─── Detail Side Panel ───────────────────────────────────── */

function DetailPanel({
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
            {(item.rating != null && item.rating > 0 || item.genres?.length > 0) && (
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
