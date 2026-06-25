import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Film, Filter, Heart, MonitorPlay, Plus, Search, SlidersHorizontal, Star, Tv, X } from "lucide-react";
import { api, CatalogList, SearchResult, WatchProvider } from "../api";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { useToast } from "../hooks/useToast";
import {
  useSearchFilters,
  FilterType,
  SortOption,
  GENRE_OPTIONS,
  SORT_LABELS,
} from "../hooks/useSearchFilters";

/* ─── Helpers ─── */

function applyFiltersAndSort(
  results: SearchResult[],
  genre: string,
  yearMin: string,
  yearMax: string,
  ratingMin: string,
  sort: SortOption,
): SearchResult[] {
  let filtered = results;

  if (genre) {
    const g = genre.toLowerCase();
    filtered = filtered.filter((r) =>
      r.genres.some((rg) => rg.toLowerCase() === g)
    );
  }

  if (yearMin) {
    const min = parseInt(yearMin, 10);
    if (!isNaN(min)) filtered = filtered.filter((r) => r.year != null && r.year >= min);
  }

  if (yearMax) {
    const max = parseInt(yearMax, 10);
    if (!isNaN(max)) filtered = filtered.filter((r) => r.year != null && r.year <= max);
  }

  if (ratingMin) {
    const min = parseFloat(ratingMin);
    if (!isNaN(min)) filtered = filtered.filter((r) => r.rating != null && r.rating >= min);
  }

  // Sort
  switch (sort) {
    case "rating":
      filtered = [...filtered].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      break;
    case "year_desc":
      filtered = [...filtered].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      break;
    case "year_asc":
      filtered = [...filtered].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
      break;
    case "title":
      filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "relevance":
    default:
      break;
  }

  return filtered;
}

/* ─── Main Component ─── */

export function SearchPage() {
  const { filters, setFilters, clearFilters, hasActiveFilters, activeFilterCount } = useSearchFilters();
  const [rawResults, setRawResults] = useState<SearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [lists, setLists] = useState<CatalogList[]>([]);
  const [pendingAdds, setPendingAdds] = useState<Record<string, boolean>>({});
  const { showToast } = useToast();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading } = useDetailPanel();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastSearchRef = useRef<{ filter: FilterType; query: string }>({ filter: "all", query: "" });
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Load lists + providers on mount
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

  // Abort any in-flight search when the page unmounts
  useEffect(() => {
    return () => abortRef.current?.abort();
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

  const listMap = useMemo(() => {
    const map = new Map<string, CatalogList>();
    for (const l of lists) map.set(l.id, l);
    return map;
  }, [lists]);

  const doSearch = useCallback(
    async (searchFilter: FilterType, searchQuery: string) => {
      if (!searchQuery.trim()) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const requestId = ++requestIdRef.current;
      setIsSearching(true);
      lastSearchRef.current = { filter: searchFilter, query: searchQuery };

      try {
        if (searchFilter === "all") {
          const [movies, series] = await Promise.all([
            api.search("movie", searchQuery, controller.signal),
            api.search("series", searchQuery, controller.signal),
          ]);
          if (requestIdRef.current !== requestId) return;
          const merged: SearchResult[] = [];
          const maxLen = Math.max(movies.length, series.length);
          for (let i = 0; i < maxLen; i++) {
            if (i < movies.length) merged.push(movies[i]);
            if (i < series.length) merged.push(series[i]);
          }
          setRawResults(merged);
        } else {
          const response = await api.search(searchFilter, searchQuery, controller.signal);
          if (requestIdRef.current !== requestId) return;
          setRawResults(response);
        }
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setRawResults([]);
        showToast(err instanceof Error ? err.message : "Search failed", "error");
      } finally {
        if (requestIdRef.current === requestId) {
          setIsSearching(false);
        }
      }
    },
    [showToast]
  );

  // Filtered + sorted results
  const results = useMemo(() => {
    if (!rawResults) return null;
    return applyFiltersAndSort(
      rawResults,
      filters.genre,
      filters.yearMin,
      filters.yearMax,
      filters.ratingMin,
      filters.sort,
    );
  }, [rawResults, filters.genre, filters.yearMin, filters.yearMax, filters.ratingMin, filters.sort]);

  // Debounced auto-search on query/filter change
  useEffect(() => {
    if (!filters.query.trim()) {
      // Invalidate any in-flight request so its response is discarded
      ++requestIdRef.current;
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      lastSearchRef.current = { filter: filters.filter, query: "" };
      setRawResults(null);
      setIsSearching(false);
      return;
    }
    // Only re-search if query or media type filter actually changed
    const last = lastSearchRef.current;
    if (last.query === filters.query && last.filter === filters.filter) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doSearch(filters.filter, filters.query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters.query, filters.filter, doSearch]);

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await doSearch(filters.filter, filters.query);
  };

  const handleAdd = async (listId: string, result: SearchResult) => {
    const key = `${listId}:${result.imdbId}`;
    if (pendingAdds[key]) return;

    setPendingAdds((current) => ({ ...current, [key]: true }));

    try {
      await api.addToList(listId, { type: result.type, imdbId: result.imdbId, title: result.name });
      const listName = listMap.get(listId)?.name ?? "list";
      showToast(`Added "${result.name}" to ${listName}`, "success");
      setLists((prev) =>
        prev.map((l) =>
          l.id === listId ? { ...l, itemCount: l.itemCount + 1 } : l
        )
      );
      setRawResults((prev) =>
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

  // Collect genres from current results for smart suggestions
  const availableGenres = useMemo(() => {
    if (!rawResults) return GENRE_OPTIONS;
    const found = new Set<string>();
    for (const r of rawResults) {
      for (const g of r.genres) found.add(g);
    }
    // Merge with common genres, prioritizing found ones
    const all = [...found, ...GENRE_OPTIONS.filter((g) => !found.has(g))];
    return all;
  }, [rawResults]);

  const hasSearched = rawResults !== null;
  const noResults = hasSearched && (results?.length ?? 0) === 0;

  return (
    <div className="relative space-y-6">
      {/* Search bar */}
      <form
        onSubmit={submitSearch}
        className="sticky top-[76px] z-40 rounded-2xl border border-ink-100 bg-cream-50/90 p-4 backdrop-blur-xl shadow-sm"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400" />
          <input
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            placeholder="Search movies & TV shows..."
            className="w-full rounded-full border border-ink-200 bg-white py-3.5 pl-14 pr-12 text-base text-ink-900 placeholder:text-ink-400 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15 transition-all"
            autoFocus
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => { setFilters({ query: "" }); setRawResults(null); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-ink-200 text-xs font-bold text-ink-900 hover:bg-ink-300 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter pills + advanced toggle */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <div className="flex rounded-full border border-ink-200 bg-ink-100/60 p-1">
            {filterOptions.map((opt) => {
              const Icon = opt.icon;
              const active = filters.filter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFilters({ filter: opt.value })}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                    active
                      ? "bg-claw-500 text-white shadow-sm"
                      : "text-ink-500 hover:text-ink-900"
                  }`}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Advanced filters toggle */}
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all ${
              hasActiveFilters
                ? "border-claw-500/50 bg-claw-500/10 text-claw-600"
                : "border-ink-200 bg-ink-100/60 text-ink-500 hover:text-ink-900"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-claw-500 text-2xs font-bold text-white">
                {activeFilterCount}
              </span>
            )}
            {filtersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-ink-500 hover:text-ink-900 transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}

          {isSearching && (
            <span className="ml-auto flex items-center gap-2 text-sm text-ink-500">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-claw-500 border-t-transparent" />
              Searching...
            </span>
          )}
        </div>

        {/* Advanced filters panel */}
        {filtersOpen && (
          <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-ink-100 bg-cream-50 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {/* Genre */}
            <FilterSelect
              label="Genre"
              value={filters.genre}
              onChange={(v) => setFilters({ genre: v })}
              options={[{ value: "", label: "Any genre" }, ...availableGenres.map((g) => ({ value: g, label: g }))]}
            />

            {/* Year range */}
            <div className="flex flex-col gap-1">
              <label className="text-2xs font-medium uppercase tracking-wider text-ink-500">Year</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  placeholder="From"
                  aria-label="Minimum year"
                  min="1900"
                  max="2030"
                  value={filters.yearMin}
                  onChange={(e) => setFilters({ yearMin: e.target.value })}
                  className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-claw-500 focus:outline-none focus:ring-1 focus:ring-claw-500/30"
                />
                <input
                  type="number"
                  placeholder="To"
                  aria-label="Maximum year"
                  min="1900"
                  max="2030"
                  value={filters.yearMax}
                  onChange={(e) => setFilters({ yearMax: e.target.value })}
                  className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-claw-500 focus:outline-none focus:ring-1 focus:ring-claw-500/30"
                />
              </div>
            </div>

            {/* Min rating */}
            <FilterSelect
              label="Min Rating"
              value={filters.ratingMin}
              onChange={(v) => setFilters({ ratingMin: v })}
              options={[
                { value: "", label: "Any rating" },
                { value: "9", label: "9+ Exceptional" },
                { value: "8", label: "8+ Great" },
                { value: "7", label: "7+ Good" },
                { value: "6", label: "6+ Decent" },
                { value: "5", label: "5+ Average" },
              ]}
            />

            {/* Sort */}
            <FilterSelect
              label="Sort by"
              value={filters.sort}
              onChange={(v) => setFilters({ sort: v as SortOption })}
              options={Object.entries(SORT_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </div>
        )}
      </form>

      {/* Empty state – no search yet */}
      {!hasSearched && !isSearching && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-ink-100 ring-1 ring-ink-200">
            <Search className="h-14 w-14 text-ink-400" />
          </div>
          <p className="mt-6 text-2xl font-bold text-ink-900">Discover your next favorite</p>
          <p className="mt-2 max-w-sm text-ink-500">
            Search for movies and series to add them to your lists and track what you watch.
          </p>
        </div>
      )}

      {/* No results */}
      {noResults && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-ink-100 ring-1 ring-ink-200">
            <Filter className="h-12 w-12 text-ink-400" />
          </div>
          <p className="mt-5 text-lg font-semibold text-ink-700">No results found</p>
          <p className="mt-1 text-sm text-ink-500">
            {hasActiveFilters
              ? "Try adjusting your filters or search term."
              : "Try a different search term or filter."}
          </p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="mt-3 rounded-full border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 transition-colors"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Results grid */}
      {hasSearched && results !== null && results.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-500">
              {results.length} result{results.length !== 1 ? "s" : ""}
              {rawResults && results.length !== rawResults.length && (
                <span className="text-ink-400"> (filtered from {rawResults.length})</span>
              )}
            </p>
            {/* Inline sort shortcut on desktop */}
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-2xs text-ink-500">Sort:</span>
              {(["relevance", "rating", "year_desc", "title"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilters({ sort: s })}
                  className={`rounded-full px-2.5 py-1 text-2xs font-medium transition-all ${
                    filters.sort === s
                      ? "bg-ink-700 text-white"
                      : "text-ink-500 hover:text-ink-900"
                  }`}
                >
                  {SORT_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {results.map((result, index) => (
              <ResultCard
                key={`${result.type}:${result.imdbId}`}
                result={result}
                eager={index < 5}
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
          onHistoryChange={(events) => setPanelHistory(events)}
        />
      )}

    </div>
  );
}

/* ─── Filter Select ─── */

function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-2xs font-medium uppercase tracking-wider text-ink-400">{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-sm text-ink-800 focus:border-claw-500 focus:outline-none focus:ring-1 focus:ring-claw-500/30 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238f8475' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 10px center",
          paddingRight: "2rem",
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

/* ─── Result Card ─────────────────────────────────────────── */

function ResultCard({
  result,
  eager = false,
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
  eager?: boolean;
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
        className="card-lift relative cursor-pointer overflow-hidden rounded-xl ring-1 ring-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2"
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
            loading={eager ? "eager" : "lazy"}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-100 to-ink-200">
            <Film className="h-12 w-12 text-ink-400" />
          </div>
        )}

        {/* Type badge */}
        <span
          className={`absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide shadow-lg ${
            result.type === "movie"
              ? "bg-claw-500/90 text-white"
              : "bg-plum-500/90 text-white"
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
          className="absolute bottom-3 right-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-claw-500 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 shadow-lg transition-all duration-300 hover:bg-claw-600 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-300 focus-visible:ring-offset-2"
          aria-label={`Add ${result.name} to a list`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <Plus className="h-4 w-4" strokeWidth={3} />
        </button>

        {/* Watchlist indicator */}
        {listNames.length > 0 && (
          <div className="absolute top-2.5 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-claw-500 shadow-lg">
            <Heart className="h-4 w-4 fill-white text-white" />
          </div>
        )}
      </div>

      {/* Quick-add dropdown */}
      {isOpen && (
        <div ref={dropdownRef} className="relative z-30 mt-1">
          <div role="menu" aria-label={`Add ${result.name} to a list`} className="absolute left-0 right-0 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-lg">
            <p className="border-b border-ink-100 px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-500">
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
                  role="menuitem"
                  disabled={already || pending}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onAdd(list.id, result);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-ink-100 disabled:opacity-50"
                >
                  {already ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 text-ink-500" />
                  )}
                  <span className={already ? "text-ink-400" : "text-ink-800"}>{list.name}</span>
                  {already && <span className="ml-auto text-2xs text-ink-400">Added</span>}
                  {pending && (
                    <span className="ml-auto inline-block h-3 w-3 animate-spin rounded-full border border-claw-500 border-t-transparent" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Title & metadata */}
      <div className="mt-3">
        <p className="truncate text-sm font-semibold text-ink-900">{result.name}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-xs text-ink-500">{result.year ?? "Unknown year"}</span>
          {result.rating != null && result.rating > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-amber-600">
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
              {result.rating.toFixed(1)}
            </span>
          )}
          {listNames.length > 0 && (
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-2xs font-medium text-ink-600" title={listNames.join(", ")}>
              In {listNames.join(", ")}
            </span>
          )}
        </div>
        {result.genres.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {result.genres.slice(0, 3).map((g) => (
              <span key={g} className="rounded bg-ink-100 px-1.5 py-0.5 text-2xs text-ink-600">{g}</span>
            ))}
          </div>
        )}
        <WhereToWatchBadge type={result.type} imdbId={result.imdbId} />
      </div>
    </div>
  );
}

/* ─── Where to Watch Badge ────────────────────────────────── */

function WhereToWatchBadge({ type, imdbId }: { type: SearchResult["type"]; imdbId: string }) {
  const [providers, setProviders] = useState<WatchProvider[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        api
          .getWatchProviders(type, imdbId)
          .then((r) => {
            const merged = [...r.providers.flatrate, ...r.providers.free];
            const deduped = merged.filter((p, i) => merged.findIndex((q) => q.id === p.id) === i);
            if (!cancelled) setProviders(deduped);
          })
          .catch(() => { if (!cancelled) setProviders([]); });
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => { cancelled = true; observer.disconnect(); };
  }, [type, imdbId]);

  if (!providers || providers.length === 0) return <div ref={ref} />;

  return (
    <div ref={ref} className="mt-1.5 flex items-center gap-1" title={`Streaming on ${providers.map((p) => p.name).join(", ")}`}>
      {providers.slice(0, 4).map((p) => (
        p.logo ? (
          <img key={p.id} src={p.logo} alt={p.name} className="h-4 w-4 rounded" />
        ) : (
          <MonitorPlay key={p.id} className="h-3.5 w-3.5 text-ink-400" />
        )
      ))}
    </div>
  );
}
