import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Check, ChevronDown, ChevronUp, Film, Filter, Heart, MonitorPlay, Plus, Search, SlidersHorizontal, Star, Tv, X } from "lucide-react";
import { api, CatalogList, SearchResult, WatchProvider } from "../api";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { useToast } from "../hooks/useToast";
import { buildTmdbSrcSet, POSTER_GRID_SIZES } from "../components/Poster";
import { mergeByRelevance } from "../utils/mergeSearchResults";
import { formatRating, ratingLabel, RATING_MAX } from "../utils/rating";
import {
  useSearchFilters,
  FilterType,
  SortOption,
  GENRE_OPTIONS,
  SORT_LABELS,
} from "../hooks/useSearchFilters";
import { PAGE_TITLE, SECTION_TITLE, MICRO_LABEL } from "../components/typography";
import { SelectField } from "../components/SelectField";

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
  const [needsTmdb, setNeedsTmdb] = useState(false);
  // Held as state rather than left to the toast: the toast fades, and the page
  // it fades off said "No results found" — a search that failed reported for
  // the rest of the session as a search that came back empty.
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [lists, setLists] = useState<CatalogList[]>([]);
  const [pendingAdds, setPendingAdds] = useState<Record<string, boolean>>({});
  const { showToast } = useToast();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading, detail: panelDetail, detailLoading: panelDetailLoading } = useDetailPanel();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
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
      setNeedsTmdb(false);
      setSearchError(null);
      lastSearchRef.current = { filter: searchFilter, query: searchQuery };

      try {
        if (searchFilter === "all") {
          const [movies, series] = await Promise.all([
            api.search("movie", searchQuery, controller.signal),
            api.search("series", searchQuery, controller.signal),
          ]);
          if (requestIdRef.current !== requestId) return;
          setRawResults(mergeByRelevance(movies, series, searchQuery));
        } else {
          const response = await api.search(searchFilter, searchQuery, controller.signal);
          if (requestIdRef.current !== requestId) return;
          setRawResults(response);
        }
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setRawResults([]);
        const message = err instanceof Error ? err.message : "Search failed";
        setNeedsTmdb(/tmdb/i.test(message));
        setSearchError(message);
        showToast(message, "error");
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
      setSearchError(null);
      setNeedsTmdb(false);
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

  const handleCreateAndAdd = async (rawName: string, result: SearchResult) => {
    const name = rawName.trim();
    if (!name) return;
    // createList and addToList are two separate calls: keep a successfully created
    // list in state even if the add then fails, report the two failures distinctly,
    // and only claim full success once both complete. The created list stays in the
    // menu so the user can retry the add without spawning a duplicate list.
    let list: CatalogList;
    try {
      ({ list } = await api.createList(name));
      setLists((prev) => [...prev, list]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Unable to create list", "error");
      return;
    }
    try {
      await api.addToList(list.id, { type: result.type, imdbId: result.imdbId, title: result.name });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown error";
      showToast(`Created "${list.name}", but couldn't add "${result.name}" (${reason})`, "error");
      setOpenDropdown(null);
      return;
    }
    showToast(`Created "${list.name}" and added "${result.name}"`, "success");
    setLists((prev) =>
      prev.map((l) => (l.id === list.id ? { ...l, itemCount: l.itemCount + 1 } : l))
    );
    setRawResults((prev) =>
      prev?.map((r) =>
        r.imdbId === result.imdbId ? { ...r, lists: [...r.lists, list.id] } : r
      ) ?? null
    );
    setOpenDropdown(null);
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
      {/* Search bar.

          Two radii in this panel, and only two: surfaces are rounded-2xl (this
          form, the advanced-filters grid inside it), controls are pills
          (the query field, the type toggle, the year inputs, the selects). It
          previously ran to four — 2xl, xl, full and lg stacked inside one
          another — which read as four unrelated widgets rather than one panel. */}
      <form
        onSubmit={submitSearch}
        className="glass-surface sticky top-[76px] z-40 rounded-2xl p-4 backdrop-blur-xl shadow-e1"
        style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg-1) 90%, transparent)" }}
      >
        {/* The search field is the page's title bar, so the h1 is hidden rather
            than duplicated above it — the outline still needs one. */}
        <h1 className="sr-only">Search</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2" style={{ color: "var(--text-mute)" }} />
          <input
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            placeholder="Search movies & TV shows..."
            aria-label="Search movies and TV shows"
            className="w-full rounded-full py-3.5 pl-14 pr-12 text-base placeholder:text-[var(--text-mute)] focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15 transition-all duration-base"
            style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border-strong)", background: "var(--bg-0)", color: "var(--text)" }}
            autoFocus={typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches}
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => { setFilters({ query: "" }); setRawResults(null); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold hover:bg-[var(--border-strong)] transition-colors"
              style={{ backgroundColor: "var(--border)", color: "var(--text)" }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter pills + advanced toggle */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <div className="flex rounded-full bg-[var(--surface)] p-1" style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border-strong)" }}>
            {filterOptions.map((opt) => {
              const Icon = opt.icon;
              const active = filters.filter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFilters({ filter: opt.value })}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-base ${
                    active
                      ? "bg-claw-500 text-claw-on shadow-e1"
                      : "text-[var(--text-mute)] hover:text-[var(--text)]"
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
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all duration-base ${
              hasActiveFilters
                ? "border-claw-500/50 bg-claw-500/10 text-claw-text"
                : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-mute)] hover:text-[var(--text)]"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-claw-500 text-2xs font-bold text-claw-on">
                {activeFilterCount}
              </span>
            )}
            {filtersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-[var(--text-mute)] hover:text-[var(--text)] transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}

          {isSearching && (
            <span className="ml-auto flex items-center gap-2 text-sm" style={{ color: "var(--text-mute)" }}>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-claw-500 border-t-transparent" />
              Searching...
            </span>
          )}
        </div>

        {/* Advanced filters panel */}
        {filtersOpen && (
          <div className="mt-3 grid grid-cols-2 gap-3 rounded-2xl p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", background: "var(--surface)" }}>
            {/* Genre */}
            <FilterSelect
              label="Genre"
              value={filters.genre}
              onChange={(v) => setFilters({ genre: v })}
              options={[{ value: "", label: "Any genre" }, ...availableGenres.map((g) => ({ value: g, label: g }))]}
            />

            {/* Year range */}
            <div className="flex flex-col gap-1">
              <label className={MICRO_LABEL} style={{ color: "var(--text-mute)" }}>Year</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  placeholder="From"
                  aria-label="Minimum year"
                  min="1900"
                  max="2030"
                  value={filters.yearMin}
                  onChange={(e) => setFilters({ yearMin: e.target.value })}
                  className="w-full min-w-0 rounded-full px-1.5 py-2 text-center text-sm placeholder:text-[var(--text-mute)] focus:border-claw-500 focus:outline-none focus:ring-1 focus:ring-claw-500/30"
                  style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border-strong)", background: "var(--bg-0)", color: "var(--text)" }}
                />
                <input
                  type="number"
                  placeholder="To"
                  aria-label="Maximum year"
                  min="1900"
                  max="2030"
                  value={filters.yearMax}
                  onChange={(e) => setFilters({ yearMax: e.target.value })}
                  className="w-full min-w-0 rounded-full px-1.5 py-2 text-center text-sm placeholder:text-[var(--text-mute)] focus:border-claw-500 focus:outline-none focus:ring-1 focus:ring-claw-500/30"
                  style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border-strong)", background: "var(--bg-0)", color: "var(--text)" }}
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
          <div className="flex h-28 w-28 items-center justify-center rounded-full ring-1" style={{ backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border-strong)" } as React.CSSProperties}>
            <Search className="h-14 w-14" style={{ color: "var(--text-mute)" }} />
          </div>
          <p className={`mt-6 ${PAGE_TITLE}`} style={{ color: "var(--text)" }}>Discover your next favorite</p>
          <p className="mt-2 max-w-sm" style={{ color: "var(--text-mute)" }}>
            Search for movies and series to add them to your lists and track what you watch.
          </p>
        </div>
      )}

      {/* No results */}
      {noResults && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full ring-1" style={{ backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border-strong)" } as React.CSSProperties}>
            <Filter className="h-12 w-12" style={{ color: "var(--text-mute)" }} />
          </div>
          <p className={`mt-5 ${SECTION_TITLE}`} style={{ color: "var(--text-dim)" }}>
            {needsTmdb ? "Search needs a TMDB API key" : searchError ? "Search failed" : "No results found"}
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-mute)" }}>
            {needsTmdb
              ? "Movie and series search is powered by TMDB — set up a free API key to start searching."
              : searchError
                ? searchError
                : hasActiveFilters
                  ? "Try adjusting your filters or search term."
                  : "Try a different search term or filter."}
          </p>
          {needsTmdb && (
            <Link
              to="/settings?tab=integrations"
              className="mt-3 rounded-full px-4 py-2 text-sm font-medium text-claw-text transition-colors hover:bg-[var(--surface)]"
              style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border-strong)" }}
            >
              Set up TMDB in Settings &rarr;
            </Link>
          )}
          {/* Not offered when the search itself failed: clearing filters
              re-filters nothing, since no results were ever returned. */}
          {hasActiveFilters && !needsTmdb && !searchError && (
            <button
              onClick={clearFilters}
              className="mt-3 rounded-full px-4 py-2 text-sm font-medium hover:bg-[var(--surface)] transition-colors"
              style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border-strong)", color: "var(--text-dim)" }}
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
            <p className="text-sm tabular-nums" style={{ color: "var(--text-mute)" }}>
              {results.length} result{results.length !== 1 ? "s" : ""}
              {rawResults && results.length !== rawResults.length && (
                <span style={{ color: "var(--text-mute)" }}> (filtered from {rawResults.length})</span>
              )}
            </p>
            {/* Inline sort shortcut on desktop */}
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-2xs" style={{ color: "var(--text-mute)" }}>Sort:</span>
              {(["relevance", "rating", "year_desc", "title"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilters({ sort: s })}
                  className={`rounded-full px-2.5 py-1 text-2xs font-medium transition-all duration-base ${
                    filters.sort === s
                      ? "text-white"
                      : "hover:text-[var(--text)]"
                  }`}
                  style={filters.sort === s ? { backgroundColor: "var(--text-dim)" } : { color: "var(--text-mute)" }}
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
                onCloseDropdown={() => setOpenDropdown(null)}
                onAdd={handleAdd}
                onCreateAndAdd={handleCreateAndAdd}
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
          detail={panelDetail}
          detailLoading={panelDetailLoading}
          onClose={() => setSelectedItem(null)}
          onShowToast={showToast}
          onHistoryChange={(events) => setPanelHistory(events)}
          onSelectItem={setSelectedItem}
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
      <label htmlFor={id} className={MICRO_LABEL} style={{ color: "var(--text-mute)" }}>{label}</label>
      <SelectField
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-full px-3 py-2 text-sm"
        style={{ color: "var(--text-dim)" }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </SelectField>
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
  onCloseDropdown,
  onAdd,
  onCreateAndAdd,
  onSelect,
}: {
  result: SearchResult;
  eager?: boolean;
  lists: CatalogList[];
  listMap: Map<string, CatalogList>;
  pendingAdds: Record<string, boolean>;
  openDropdown: string | null;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  onToggleDropdown: (id: string) => void;
  onCloseDropdown: () => void;
  onAdd: (listId: string, result: SearchResult) => Promise<void>;
  onCreateAndAdd: (name: string, result: SearchResult) => Promise<void>;
  onSelect: (result: SearchResult) => void;
}) {
  const isOpen = openDropdown === result.imdbId;
  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [savingNewList, setSavingNewList] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const restoreCreateFocus = useRef(false);
  const panelId = useId();

  // Reset the inline create form whenever this card's menu closes.
  useEffect(() => {
    if (!isOpen) { setCreating(false); setNewListName(""); }
  }, [isOpen]);

  // Move focus into the popup on open. Without this a keyboard user is left on
  // the trigger with the panel hanging open behind them, and has to tab through
  // the rest of the card to reach it.
  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.querySelector<HTMLElement>("button:not([disabled]), input")?.focus();
  }, [isOpen]);

  const closeAndFocusTrigger = () => {
    onCloseDropdown();
    triggerRef.current?.focus();
  };

  // Backing out of the create field unmounts the focused input, so hand focus
  // to the button that replaces it — otherwise the panel is left with no
  // focused child and handlePanelBlur closes the whole dropdown.
  const exitCreate = () => {
    setCreating(false);
    setNewListName("");
    restoreCreateFocus.current = true;
  };

  useEffect(() => {
    if (creating || !restoreCreateFocus.current) return;
    restoreCreateFocus.current = false;
    createButtonRef.current?.focus();
  }, [creating]);

  // Tab (or anything else) taking focus out of the panel closes it. Checked on
  // the next frame rather than straight off relatedTarget, because toggling the
  // inline create form unmounts the focused button and fires a focusout with a
  // null relatedTarget before the new field has mounted to receive focus.
  //
  // The trigger is exempt from both checks: focus lands on it before its own
  // click runs, and closing here first would leave that click to reopen the
  // panel it was meant to dismiss.
  const handlePanelBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (e.currentTarget.contains(next) || (next && next === triggerRef.current)) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active === triggerRef.current) return;
      if (panelRef.current && !panelRef.current.contains(active)) onCloseDropdown();
    });
  };

  const submitNewList = async () => {
    if (!newListName.trim() || savingNewList) return;
    setSavingNewList(true);
    try {
      await onCreateAndAdd(newListName, result);
    } finally {
      setSavingNewList(false);
    }
  };
  const listNames = result.lists
    .map((id) => listMap.get(id)?.name)
    .filter(Boolean) as string[];

  return (
    <div className="group flex flex-col">
      {/* Poster */}
      <div
        role="button"
        tabIndex={0}
        // `ring-black/5` was invisible on the four dark themes, so cards of the
        // same rank carried two different edge treatments — this one and the
        // Dashboard's themed hairline. --border matches the Dashboard. It stays
        // a ring rather than an inline inset shadow so .card-lift's hover
        // shadow can still replace it; an inline style would outrank that.
        className="card-lift relative cursor-pointer overflow-hidden rounded-xl ring-1 ring-[var(--border)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
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
            srcSet={buildTmdbSrcSet(result.poster)}
            sizes={POSTER_GRID_SIZES}
            alt={result.name}
            className="h-full w-full object-cover transition-transform duration-slow group-hover:scale-105"
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : "low"}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br" style={{ "--tw-gradient-from": "var(--surface)", "--tw-gradient-to": "var(--surface-strong)" } as React.CSSProperties}>
            <Film className="h-12 w-12" style={{ color: "var(--text-mute)" }} />
          </div>
        )}

        {/* Type badge */}
        <span
          className={`absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide shadow-e1 ring-1 ring-black/15 ${
            result.type === "movie"
              ? "bg-claw-500 text-claw-on"
              : "bg-plum-500/90 text-white"
          }`}
          // The movie badge takes its foreground from --on-accent, which is already
          // contrast-checked against the accent in every theme — a dark halo behind it
          // would fight the near-black label. The plum series badge is white-on-fixed-
          // colour, so it keeps the halo that holds it up over bright posters.
          style={result.type === "movie" ? undefined : { textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
        >
          {result.type === "movie" ? <Film className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
          {result.type === "movie" ? "Movie" : "Series"}
        </span>

        {/* Gradient overlay: low resting opacity on desktop so it stays discoverable without a hover, full on hover/focus */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 transition-opacity duration-slow sm:opacity-30 sm:group-hover:opacity-100" />

        {/* Quick-add button: same low-resting-opacity treatment so trackpad/keyboard users see it exists before hovering/focusing */}
        <button
          ref={triggerRef}
          type="button"
          // The outside-click handler is a document mousedown listener and the
          // trigger sits outside the panel, so without this it closed the
          // dropdown on mousedown and the click that followed reopened it —
          // making the button unable to dismiss its own panel.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDropdown(result.imdbId);
          }}
          className="absolute bottom-3 right-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-claw-500 text-claw-on opacity-100 sm:opacity-60 sm:group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 shadow-e2 transition-all duration-slow hover:bg-claw-600 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-300 focus-ring-offset"
          aria-label={`Add ${result.name} to a list`}
          aria-expanded={isOpen}
          aria-controls={isOpen ? panelId : undefined}
        >
          <Plus className="h-4 w-4" strokeWidth={3} />
        </button>

        {/* Watchlist indicator */}
        {listNames.length > 0 && (
          <div className="absolute top-2.5 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-claw-500 shadow-e1">
            <Heart className="h-4 w-4 fill-claw-on text-claw-on" />
          </div>
        )}
      </div>

      {/* Quick-add dropdown */}
      {isOpen && (
        <div ref={dropdownRef} className="relative z-30 mt-1">
          {/*
            Deliberately not role="menu". The panel holds a text field and a
            submit button for the inline create flow, which the ARIA menu
            pattern doesn't allow — announcing a menu promised arrow-key
            navigation that was never implemented, which is worse for
            assistive-tech users than the plain disclosure this actually is.
            Trigger keeps aria-expanded/aria-controls; the buttons stay in the
            natural tab order, and Escape closes and restores focus.
          */}
          <div
            ref={panelRef}
            id={panelId}
            role="group"
            aria-label={`Add ${result.name} to a list`}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeAndFocusTrigger(); } }}
            onBlur={handlePanelBlur}
            className="absolute left-0 right-0 overflow-hidden rounded-xl shadow-e2"
            style={{ background: "var(--bg-0)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)" }}
          >
            <p className={`px-3 py-2.5 ${MICRO_LABEL}`} style={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "var(--border)", color: "var(--text-mute)" }}>
              Add to list
            </p>
            {lists.length === 0 && !creating && (
              <p className="px-3 py-2.5 text-2xs" style={{ color: "var(--text-mute)" }}>
                No lists yet — create one below.
              </p>
            )}
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
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--surface)] disabled:opacity-50"
                >
                  {already ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" style={{ color: "var(--text-mute)" }} />
                  )}
                  <span style={{ color: already ? "var(--text-mute)" : "var(--text-dim)" }}>{list.name}</span>
                  {already && <span className="ml-auto text-2xs" style={{ color: "var(--text-mute)" }}>Added</span>}
                  {pending && (
                    <span className="ml-auto inline-block h-3 w-3 animate-spin rounded-full border border-claw-500 border-t-transparent" />
                  )}
                </button>
              );
            })}
            {creating ? (
              <div
                className="flex items-center gap-2 px-3 py-2.5"
                style={{ borderTopWidth: lists.length > 0 ? 1 : 0, borderTopStyle: "solid", borderTopColor: "var(--border)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  autoFocus
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void submitNewList(); }
                    // stopPropagation so Escape backs out of the create field
                    // only — the panel's handler would otherwise close the
                    // whole dropdown in the same keystroke.
                    if (e.key === "Escape") { e.stopPropagation(); exitCreate(); }
                  }}
                  placeholder="List name..."
                  aria-label="New list name"
                  className="min-w-0 flex-1 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-claw-500/40"
                  style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border-strong)", background: "var(--bg-1)", color: "var(--text)" }}
                />
                <button
                  type="button"
                  disabled={!newListName.trim() || savingNewList}
                  onClick={(e) => { e.stopPropagation(); void submitNewList(); }}
                  className="btn-primary btn-xs flex-none"
                >
                  {savingNewList ? "…" : "Add"}
                </button>
              </div>
            ) : (
              <button
                ref={createButtonRef}
                type="button"
                onClick={(e) => { e.stopPropagation(); setCreating(true); }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-claw-text transition-colors hover:bg-[var(--surface)]"
                style={{ borderTopWidth: lists.length > 0 ? 1 : 0, borderTopStyle: "solid", borderTopColor: "var(--border)" }}
              >
                <Plus className="h-3.5 w-3.5" />
                Create new list
              </button>
            )}
          </div>
        </div>
      )}

      {/* Title & metadata */}
      <div className="mt-3">
        <p className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{result.name}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-mute)" }}>{result.year ?? "Unknown year"}</span>
          {result.rating != null && result.rating > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-amber-600" title={ratingLabel(result.rating)}>
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
              {formatRating(result.rating)}
              <span style={{ color: "var(--text-mute)" }}>/{RATING_MAX}</span>
            </span>
          )}
          {listNames.length > 0 && (
            <span className="rounded px-1.5 py-0.5 text-2xs font-medium" style={{ backgroundColor: "var(--surface)", color: "var(--text-dim)" }} title={listNames.join(", ")}>
              In {listNames.join(", ")}
            </span>
          )}
        </div>
        {result.genres.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {result.genres.slice(0, 3).map((g) => (
              <span key={g} className="rounded px-1.5 py-0.5 text-2xs" style={{ backgroundColor: "var(--surface)", color: "var(--text-dim)" }}>{g}</span>
            ))}
          </div>
        )}
        <WhereToWatchBadge type={result.type} imdbId={result.imdbId} />
      </div>
    </div>
  );
}

/* ─── Where to Watch Badge ────────────────────────────────── */

// Module-level cache so repeated searches (and re-mounted cards) skip the network call entirely.
const providerCache = new Map<string, WatchProvider[]>();

// A single shared IntersectionObserver is far cheaper than one per card when a search
// returns 10-20 results.
type IntersectionCallback = (entry: IntersectionObserverEntry) => void;
let sharedObserver: IntersectionObserver | null = null;
const observerCallbacks = new WeakMap<Element, IntersectionCallback>();

function getSharedObserver(): IntersectionObserver {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observerCallbacks.get(entry.target)?.(entry);
        }
      },
      { rootMargin: "200px" }
    );
  }
  return sharedObserver;
}

function observeOnce(node: Element, callback: IntersectionCallback) {
  const observer = getSharedObserver();
  observerCallbacks.set(node, (entry) => {
    observer.unobserve(node);
    observerCallbacks.delete(node);
    callback(entry);
  });
  observer.observe(node);
  return () => {
    observer.unobserve(node);
    observerCallbacks.delete(node);
  };
}

function WhereToWatchBadge({ type, imdbId }: { type: SearchResult["type"]; imdbId: string }) {
  const cacheKey = `${type}:${imdbId}`;
  const [providers, setProviders] = useState<WatchProvider[] | null>(providerCache.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFailed(false);
    const cached = providerCache.get(cacheKey);
    if (cached) {
      setProviders(cached);
      return;
    }

    const node = ref.current;
    if (!node) return;

    let cancelled = false;
    const controller = new AbortController();
    const fetchProviders = () => {
      api
        .getWatchProviders(type, imdbId, controller.signal)
        .then((r) => {
          const merged = [...r.providers.flatrate, ...r.providers.free];
          const deduped = merged.filter((p, i) => merged.findIndex((q) => q.id === p.id) === i);
          providerCache.set(cacheKey, deduped);
          if (!cancelled) setProviders(deduped);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (!cancelled) setFailed(true);
        });
    };

    const unobserve = observeOnce(node, fetchProviders);
    return () => { cancelled = true; unobserve(); controller.abort(); };
  }, [type, imdbId, cacheKey]);

  if (failed) {
    return (
      <div ref={ref} className="mt-1.5 text-2xs" style={{ color: "var(--text-mute)" }} title="Failed to load streaming providers">
        Providers unavailable
      </div>
    );
  }

  if (!providers || providers.length === 0) return <div ref={ref} />;

  return (
    <div ref={ref} className="mt-1.5 flex items-center gap-1" title={`Streaming on ${providers.map((p) => p.name).join(", ")}`}>
      {providers.slice(0, 4).map((p) => (
        p.logo ? (
          <img key={p.id} src={p.logo} alt={p.name} className="h-4 w-4 rounded" />
        ) : (
          <MonitorPlay key={p.id} className="h-3.5 w-3.5" style={{ color: "var(--text-mute)" }} />
        )
      ))}
    </div>
  );
}
