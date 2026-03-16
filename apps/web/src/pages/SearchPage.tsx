import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Clock, Film, Plus, Search, Tv, X } from "lucide-react";
import { api, CatalogList, MediaType, SearchResult, WatchEvent } from "../api";

type FilterType = "all" | MediaType;

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [lists, setLists] = useState<CatalogList[]>([]);
  const [pendingAdds, setPendingAdds] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
  const [panelHistory, setPanelHistory] = useState<WatchEvent[]>([]);
  const [panelHistoryLoading, setPanelHistoryLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load lists on mount
  useEffect(() => {
    void (async () => {
      try {
        const { lists: loaded } = await api.getLists();
        setLists(loaded);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : "Failed to load lists");
      }
    })();
  }, []);

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
      setMessage(null);
      setError(null);
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
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setIsSearching(false);
      }
    },
    []
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

    setMessage(null);
    setError(null);
    setPendingAdds((current) => ({ ...current, [key]: true }));

    try {
      await api.addToList(listId, { type: result.type, imdbId: result.imdbId, title: result.name });
      const listName = listMap.get(listId)?.name ?? "list";
      setMessage(`Added "${result.name}" to ${listName}`);
      // Update local lists state to reflect the addition
      setLists((prev) =>
        prev.map((l) =>
          l.id === listId
            ? { ...l, items: [...l.items, { listId, type: result.type, imdbId: result.imdbId, addedAt: new Date().toISOString() }] }
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
      setError(err instanceof Error ? err.message : "Unable to add item");
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
        className="sticky top-16 z-40 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 backdrop-blur"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for movies & series…"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-12 pr-4 text-lg placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            autoFocus
          />
        </div>

        {/* Filter pills */}
        <div className="mt-3 flex gap-2">
          {filterOptions.map((opt) => {
            const Icon = opt.icon;
            const active = filter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFilter(opt.value)}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sky-600 text-white shadow-lg shadow-sky-600/25"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                }`}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {opt.label}
              </button>
            );
          })}
          {isSearching && (
            <span className="ml-auto flex items-center gap-2 text-sm text-slate-400">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
              Searching…
            </span>
          )}
        </div>
      </form>

      {/* Notifications */}
      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-rose-300">{error}</p>
      )}
      {message && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-emerald-300">{message}</p>
      )}

      {/* Empty state – no search yet */}
      {!hasSearched && !isSearching && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-6xl">🎬</div>
          <p className="mt-4 text-xl font-semibold text-slate-200">Discover your next favorite</p>
          <p className="mt-2 max-w-sm text-slate-400">
            Search for movies and series to add them to your lists and track what you watch.
          </p>
          <div className="mt-6 flex gap-3 text-3xl">
            <span>🍿</span>
            <span>📺</span>
            <span>🎭</span>
          </div>
        </div>
      )}

      {/* No results */}
      {noResults && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl">🔍</div>
          <p className="mt-4 text-lg font-medium text-slate-300">No results found</p>
          <p className="mt-1 text-sm text-slate-500">Try a different search term or filter.</p>
        </div>
      )}

      {/* Results grid */}
      {hasSearched && results.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
      )}

      {/* Detail side panel */}
      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          history={panelHistory}
          historyLoading={panelHistoryLoading}
          listMap={listMap}
          onClose={() => setSelectedItem(null)}
        />
      )}
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
  dropdownRef: React.RefObject<HTMLDivElement | null>;
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
        className="relative cursor-pointer overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10 transition-transform duration-200 hover:scale-[1.03]"
        style={{ aspectRatio: "var(--poster-ratio)" }}
        onClick={() => onSelect(result)}
      >
        {result.poster ? (
          <img
            src={result.poster}
            alt={result.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-800">
            <Film className="h-12 w-12 text-slate-600" />
          </div>
        )}

        {/* Type badge */}
        <span
          className={`absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-semibold shadow ${
            result.type === "movie"
              ? "bg-sky-600/90 text-white"
              : "bg-violet-600/90 text-white"
          }`}
        >
          {result.type === "movie" ? <Film className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
          {result.type === "movie" ? "Movie" : "Series"}
        </span>

        {/* Hover gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

        {/* Quick-add button (bottom-right on hover) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleDropdown(result.imdbId);
          }}
          className="absolute bottom-2 right-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-white opacity-0 shadow-lg transition-all duration-200 hover:bg-sky-500 group-hover:opacity-100"
          aria-label={`Add ${result.name} to a list`}
        >
          <Plus className="h-4 w-4" strokeWidth={3} />
        </button>
      </div>

      {/* Quick-add dropdown */}
      {isOpen && (
        <div ref={dropdownRef} className="relative z-30 mt-1">
          <div className="absolute left-0 right-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
            <p className="border-b border-slate-700 px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-slate-400">
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
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-700 disabled:opacity-50"
                >
                  {already ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  <span className={already ? "text-slate-400" : "text-slate-200"}>{list.name}</span>
                  {already && <span className="ml-auto text-2xs text-slate-500">Added</span>}
                  {pending && (
                    <span className="ml-auto inline-block h-3 w-3 animate-spin rounded-full border border-sky-500 border-t-transparent" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Title & metadata */}
      <p className="mt-2 truncate text-sm font-medium text-slate-100">{result.name}</p>
      <p className="text-xs text-slate-500">{result.year ?? "Unknown year"}</p>

      {/* List pills */}
      {listNames.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {listNames.map((name) => (
            <span
              key={name}
              className="inline-block rounded-full bg-slate-800 px-2 py-0.5 text-2xs text-slate-400 ring-1 ring-slate-700"
            >
              {name}
            </span>
          ))}
        </div>
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
}: {
  item: SearchResult;
  history: WatchEvent[];
  historyLoading: boolean;
  listMap: Map<string, CatalogList>;
  onClose: () => void;
}) {
  const listNames = item.lists
    .map((id) => listMap.get(id)?.name)
    .filter(Boolean) as string[];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 shadow-2xl sm:w-[28rem]">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-800/80 text-slate-400 backdrop-blur hover:bg-slate-700 hover:text-white"
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
            <div className="flex h-full w-full items-center justify-center bg-slate-800">
              <Film className="h-20 w-20 text-slate-600" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
        </div>

        {/* Content */}
        <div className="-mt-12 relative z-10 flex-1 space-y-5 px-5 pb-8">
          {/* Title area */}
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${
                  item.type === "movie"
                    ? "bg-sky-600/90 text-white"
                    : "bg-violet-600/90 text-white"
                }`}
              >
                {item.type === "movie" ? <Film className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                {item.type === "movie" ? "Movie" : "Series"}
              </span>
              {item.year && <span className="text-sm text-slate-400">{item.year}</span>}
            </div>
            <h2 className="mt-2 text-2xl font-bold text-white">{item.name}</h2>
          </div>

          {/* Lists */}
          {listNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {listNames.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20"
                >
                  <Check className="h-3 w-3" />
                  {name}
                </span>
              ))}
            </div>
          )}

          {/* Description */}
          {item.description && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Overview</h3>
              <p className="text-sm leading-relaxed text-slate-300">{item.description}</p>
            </div>
          )}

          {/* Watch History */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <Clock className="h-3.5 w-3.5" />
              Watch History
            </h3>
            {historyLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-10 rounded-lg" />
                ))}
              </div>
            ) : history.length === 0 ? (
              <p className="rounded-lg bg-slate-800/50 py-4 text-center text-sm text-slate-500">
                No watch history yet
              </p>
            ) : (
              <div className="space-y-1.5">
                {history.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 rounded-lg bg-slate-800/50 px-3 py-2"
                  >
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
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
