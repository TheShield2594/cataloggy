import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AlertTriangle, Check, Film, FolderOpen, Pencil, Plus, Search, Trash2, Tv, X } from "lucide-react";
import { api, CatalogList, ListItemWithMeta, MediaType, SearchResult } from "../api";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useToast } from "../hooks/useToast";
import { buildTmdbSrcSet, POSTER_GRID_SIZES } from "../components/Poster";
import { useCachedState } from "../hooks/useCachedState";
import { useScrollLock } from "../hooks/useScrollLock";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { mergeByRelevance } from "../utils/mergeSearchResults";
import { PAGE_TITLE, SECTION_TITLE } from "../components/typography";

type SortOption = "added" | "name" | "year" | "rating";

// Large imported collections (Letterboxd/Trakt) can carry thousands of items;
// rendering them all as DOM nodes at once is what actually costs, not the fetch
// (which is one indexed query), so grow the rendered slice as the user scrolls
// instead of paginating the already-sorted/filtered in-memory list.
const RENDER_PAGE_SIZE = 60;

const SORT_LABELS: Record<SortOption, string> = {
  added: "Date Added",
  name: "Name",
  year: "Year",
  rating: "Rating",
};

// Metadata rows are backfilled in the background, so an item can arrive without
// one. Fall back to the title captured when it was added before showing the bare
// IMDb ID, which is never what the user is looking for.
function itemName(item: ListItemWithMeta): string {
  return item.metadata?.name ?? item.title ?? item.imdbId;
}

function toSearchResult(item: ListItemWithMeta, list?: CatalogList): SearchResult {
  return {
    imdbId: item.imdbId,
    type: item.type,
    name: itemName(item),
    year: item.metadata?.year ?? null,
    poster: item.metadata?.poster ?? null,
    description: null,
    genres: item.metadata?.genres ?? [],
    rating: item.metadata?.rating ?? null,
    inWatchlist: list?.kind === "watchlist",
    inCollection: list?.kind === "collection",
    lists: list ? [list.id] : [],
  };
}

// Same three-way choice the search page offers, rather than the movie-or-series
// toggle this modal used to force — one task should not have two models.
type AddFilter = "all" | MediaType;

const ADD_FILTERS: { value: AddFilter; label: string; icon?: typeof Film }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies", icon: Film },
  { value: "series", label: "Series", icon: Tv },
];

const resultKey = (type: string, imdbId: string) => `${type}:${imdbId}`;

function AddItemModal({
  listId,
  listName,
  existingKeys,
  onClose,
  onAdded,
}: {
  listId: string;
  listName: string;
  /** `type:imdbId` for everything already in the list, so results can say so. */
  existingKeys: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AddFilter>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  // Added during this modal's lifetime. `existingKeys` is a snapshot taken when
  // the modal opened and the parent's refetch is in flight behind it, so without
  // this a row would sit unchanged for as long as the reload took.
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const { showToast } = useToast();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Closing the modal mid-search shouldn't leave the request running, and its
  // resolution must not set state on an unmounted component.
  useEffect(() => () => {
    requestIdRef.current++;
    abortRef.current?.abort();
  }, []);

  useScrollLock();
  useEscapeKey(onClose);

  // Debounced typing can still leave two searches in flight — more so since
  // "All" issues two requests per search — and the slower one landing last
  // would overwrite fresher results, or clear the spinner while the newer
  // search was still running. Only the newest request may touch state; the
  // rest are aborted and ignored, as on the search page.
  const doSearch = useCallback(async (q: string, f: AddFilter) => {
    abortRef.current?.abort();
    const requestId = ++requestIdRef.current;

    if (!q.trim()) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setSearching(true);
    setError(null);
    try {
      let next: SearchResult[];
      if (f === "all") {
        const [movies, series] = await Promise.all([
          api.search("movie", q, controller.signal),
          api.search("series", q, controller.signal),
        ]);
        next = mergeByRelevance(movies, series, q);
      } else {
        next = await api.search(f, q, controller.signal);
      }
      if (requestIdRef.current !== requestId) return;
      setResults(next);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      if (requestIdRef.current === requestId) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doSearch(query, filter), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, filter, doSearch]);

  const handleAdd = async (result: SearchResult) => {
    const key = resultKey(result.type, result.imdbId);
    if (adding[key] || addedKeys.has(key) || existingKeys.has(key)) return;
    setAdding((prev) => ({ ...prev, [key]: true }));
    setError(null);
    try {
      await api.addToList(listId, { type: result.type, imdbId: result.imdbId, title: result.name });
      setAddedKeys((prev) => new Set(prev).add(key));
      showToast(`Added "${result.name}" to ${listName}`, "success");
      onAdded();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add item";
      setError(message);
      showToast(`Couldn't add "${result.name}" (${message})`, "error");
    } finally {
      setAdding((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div className="overlay-scrim overlay-fade fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-item-modal-title"
        tabIndex={-1}
        className="glass-surface overlay-dialog w-full max-w-lg rounded-2xl border shadow-sm"
        style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <h3 id="add-item-modal-title" className={SECTION_TITLE} style={{ color: "var(--text)" }}>Add to {listName}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="rounded-lg p-1.5 hover:bg-[var(--surface)] hover:text-[var(--text)]" style={{ color: "var(--text-mute)" }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--text-mute)" }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movies & series..."
              aria-label="Search movies and series"
              className="w-full rounded-full border py-2.5 pl-9 pr-3 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}
            />
          </div>
          <div
            role="group"
            aria-label="Filter by type"
            className="mt-2.5 inline-flex rounded-full bg-[var(--surface)] p-1"
            style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border-strong)" }}
          >
            {ADD_FILTERS.map((opt) => {
              const Icon = opt.icon;
              const active = filter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFilter(opt.value)}
                  aria-pressed={active}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-medium transition-all ${
                    active ? "bg-claw-500 text-claw-on shadow-sm" : "text-[var(--text-mute)] hover:text-[var(--text)]"
                  }`}
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto px-5 py-3">
          {error && <p className="mb-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-600">{error}</p>}
          {searching && <p className="py-6 text-center text-sm" style={{ color: "var(--text-mute)" }}>Searching...</p>}
          {!searching && query.trim() && results.length === 0 && (
            <p className="py-6 text-center text-sm" style={{ color: "var(--text-mute)" }}>No results found.</p>
          )}
          <div className="space-y-1">
            {results.map((r) => {
              const key = resultKey(r.type, r.imdbId);
              const already = existingKeys.has(key) || addedKeys.has(key);
              const pending = adding[key];
              return (
                <button
                  key={key}
                  type="button"
                  // Nothing distinguished an item already in the list, so adding
                  // the same title twice looked exactly like adding it once.
                  disabled={pending || already}
                  onClick={() => handleAdd(r)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-[var(--surface)] disabled:opacity-60 disabled:hover:bg-transparent transition-colors"
                >
                  <div className="h-14 w-10 flex-none overflow-hidden rounded-lg ring-1" style={{ backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}>
                    {r.poster ? (
                      <img src={r.poster} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center"><Film className="h-4 w-4" style={{ color: "var(--text-mute)" }} /></div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" style={{ color: already ? "var(--text-mute)" : "var(--text)" }}>{r.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-mute)" }}>{r.year ?? "Unknown"} &middot; {r.type}</p>
                  </div>
                  {pending ? (
                    <span
                      role="status"
                      aria-label={`Adding ${r.name}`}
                      className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-claw-500 border-t-transparent"
                    />
                  ) : already ? (
                    <span className="flex flex-none items-center gap-1 text-2xs font-semibold" style={{ color: "var(--text-mute)" }}>
                      <Check className="h-4 w-4 text-emerald-600" />
                      Added
                    </span>
                  ) : (
                    <Plus className="h-4 w-4 flex-none text-claw-text" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ListsPage() {
  const [lists, setLists] = useCachedState<CatalogList[]>("lists:all", []);
  // The selection lives in the URL so a list can be linked, bookmarked and
  // reloaded, and so Back undoes a list switch instead of leaving the page.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedListId = searchParams.get("list");
  // Deliberately false even when the cache seeded `lists`. The cached copy is
  // good enough to render the sidebar immediately, but this flag also gates
  // "that list doesn't exist" messaging and the redirect to a default list —
  // and a list deleted on another device is still present in a stale cache. Both
  // wait for the fresh response.
  const [listsLoaded, setListsLoaded] = useState(false);
  const [items, setItems] = useState<ListItemWithMeta[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [removingIds, setRemovingIds] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingListId, setDeletingListId] = useState<string | null>(null);
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [filterQuery, setFilterQuery] = useState("");
  const [renderLimit, setRenderLimit] = useState(RENDER_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Read by the undo handler, which can fire long after the selection changed.
  const selectedListIdRef = useRef(selectedListId);
  selectedListIdRef.current = selectedListId;
  const { showToast } = useToast();
  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading, detail: panelDetail, detailLoading: panelDetailLoading } = useDetailPanel();

  // Pushing (rather than replacing) is what makes Back undo a list switch. The
  // one exception is the initial default, which the user never chose.
  const selectList = (listId: string | null, options?: { replace?: boolean }) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (listId) next.set("list", listId);
        else next.delete("list");
        return next;
      },
      { replace: options?.replace ?? false }
    );
  };

  // Every handler that can set `error` clears it first, so a transient failure
  // doesn't pin the banner for the rest of the session once the retry succeeds.
  const loadLists = useCallback(async () => {
    setError(null);
    try {
      const { lists: loaded } = await api.getLists();
      setLists(loaded);
      // Only a *successful* load can be used to judge an unknown ID: marking
      // this on failure too would report a list missing when what failed was
      // the request that would have found it.
      setListsLoaded(true);
      return loaded;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lists");
      return [];
    }
  }, []);

  const loadItems = useCallback(async (listId: string) => {
    setLoadingItems(true);
    setError(null);
    try {
      const { items: loaded } = await api.getListItems(listId);
      setItems(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load items");
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const selectedList = lists.find((l) => l.id === selectedListId);
  const activeListId = selectedList?.id ?? null;
  // A link can outlive the list it points at. The sidebar is the only thing
  // that knows which IDs are real, so say nothing until it has loaded.
  const listNotFound = listsLoaded && selectedListId !== null && !selectedList;

  // Landing on /lists with no list named picks the first one, replacing rather
  // than pushing so Back still leaves the page.
  useEffect(() => {
    if (listsLoaded && !selectedListId && lists.length > 0) {
      selectList(lists[0].id, { replace: true });
    }
  }, [listsLoaded, selectedListId, lists]);

  useEffect(() => {
    if (activeListId) {
      void loadItems(activeListId);
    } else {
      setItems([]);
    }
  }, [activeListId, loadItems]);

  const handleCreateList = async (e: FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    setError(null);
    try {
      const { list } = await api.createList(newListName.trim());
      setNewListName("");
      await loadLists();
      selectList(list.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create list");
    }
  };

  const handleDeleteList = async (listId: string) => {
    setDeletingListId(listId);
    setError(null);
    try {
      await api.deleteList(listId);
      setConfirmDeleteId(null);
      const remaining = await loadLists();
      // Picked from the reloaded set. Clearing the selection and leaving it to
      // the default-to-first effect would run that effect against the sidebar
      // as it was *before* the delete, landing straight back on the list that
      // was just deleted.
      if (selectedListId === listId) selectList(remaining[0]?.id ?? null, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete list");
    } finally {
      setDeletingListId(null);
    }
  };

  const cancelRename = () => {
    setRenamingListId(null);
    setRenameValue("");
  };

  const handleRenameList = async (listId: string) => {
    const name = renameValue.trim();
    if (!name) {
      cancelRename();
      return;
    }
    try {
      await api.renameList(listId, name);
      setRenamingListId(null);
      await loadLists();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to rename list", "error");
    }
  };

  // What the add modal marks as "Added". Built from the full list rather than
  // `displayedItems`, which the search box narrows — an item hidden by a filter
  // is still in the list.
  const existingItemKeys = useMemo(
    () => new Set(items.map((item) => resultKey(item.type, item.imdbId))),
    [items]
  );

  const displayedItems = useMemo(() => {
    let result = items;
    const q = filterQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((item) => itemName(item).toLowerCase().includes(q));
    }
    const sorted = [...result];
    switch (sortBy) {
      case "name":
        sorted.sort((a, b) => itemName(a).localeCompare(itemName(b)));
        break;
      case "year":
        sorted.sort((a, b) => (b.metadata?.year ?? 0) - (a.metadata?.year ?? 0));
        break;
      case "rating":
        sorted.sort((a, b) => (b.metadata?.rating ?? 0) - (a.metadata?.rating ?? 0));
        break;
      case "added":
      default:
        sorted.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
        break;
    }
    return sorted;
  }, [items, filterQuery, sortBy]);

  useEffect(() => {
    setRenderLimit(RENDER_PAGE_SIZE);
  }, [selectedListId, filterQuery, sortBy]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || renderLimit >= displayedItems.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setRenderLimit((prev) => Math.min(prev + RENDER_PAGE_SIZE, displayedItems.length));
        }
      },
      { rootMargin: "800px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [renderLimit, displayedItems.length]);

  const visibleItems = displayedItems.slice(0, renderLimit);

  // Restoring only makes sense while the same list is still on screen; the undo
  // can land after the user has clicked away, and the server-side re-add is what
  // actually matters then.
  const restoreItem = (listId: string, item: ListItemWithMeta) => {
    if (selectedListIdRef.current !== listId) return;
    setItems((prev) => (prev.some((i) => i.type === item.type && i.imdbId === item.imdbId) ? prev : [...prev, item]));
  };

  const handleUndoRemove = async (listId: string, item: ListItemWithMeta) => {
    try {
      await api.addToList(listId, { type: item.type, imdbId: item.imdbId, title: itemName(item) });
      restoreItem(listId, item);
      await loadLists();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not restore item", "error");
    }
  };

  // The remove button overlaps a poster whose whole surface opens the detail
  // panel, and it renders at full opacity on touch, so a mis-tap is easy. The
  // removal is optimistic and the toast carries the way back.
  const handleRemove = async (item: ListItemWithMeta) => {
    if (!selectedListId || removingIds[item.imdbId]) return;
    const listId = selectedListId;
    setRemovingIds((prev) => ({ ...prev, [item.imdbId]: true }));
    setError(null);
    setItems((prev) => prev.filter((i) => i.imdbId !== item.imdbId));
    try {
      await api.removeFromList(listId, { type: item.type, imdbId: item.imdbId });
      showToast(`Removed ${itemName(item)}`, "info", {
        action: { label: "Undo", onAction: () => void handleUndoRemove(listId, item) },
      });
      await loadLists();
    } catch (err) {
      restoreItem(listId, item);
      setError(err instanceof Error ? err.message : "Failed to remove item");
    } finally {
      setRemovingIds((prev) => ({ ...prev, [item.imdbId]: false }));
    }
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-8">
      {/* The visible headline is the selected list's name, which changes as you
          click around, so the page keeps a stable hidden h1 above it. */}
      <h1 className="sr-only">Lists</h1>
      {/* Sidebar */}
      <aside className="w-full shrink-0 md:w-56 lg:w-64">
        {/* Mobile: horizontal scrollable tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide md:flex-col md:overflow-x-visible md:pb-0">
          {lists.map((list) => (
            <div key={list.id} className="relative flex-none md:w-full">
              {confirmDeleteId === list.id && list.kind === "custom" ? (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 flex-none text-rose-500" />
                    <p className="text-xs font-semibold text-rose-600">Delete "{list.name}"?</p>
                  </div>
                  <p className="text-xs mb-3" style={{ color: "var(--text-mute)" }}>This will remove the list and all its items.</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={deletingListId === list.id}
                      onClick={() => void handleDeleteList(list.id)}
                      className="flex-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-60 transition-colors"
                    >
                      {deletingListId === list.id ? "Deleting…" : "Delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-[var(--surface)] transition-colors"
                      style={{ borderColor: "var(--border)", color: "var(--text-dim)", background: "var(--bg-1)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`group flex items-center rounded-xl border transition-all md:w-full ${
                  selectedListId === list.id
                    ? "border-claw-500/40 bg-claw-500/10"
                    : "glass-row hover:bg-[var(--surface)] hover:border-[var(--border-strong)]"
                }`}
                style={{
                  borderColor: selectedListId === list.id ? undefined : "var(--border)",
                  background: selectedListId === list.id ? undefined : "var(--bg-1)",
                }}
                >
                  <button
                    type="button"
                    onClick={() => selectList(list.id)}
                    aria-current={selectedListId === list.id ? "true" : undefined}
                    className={`min-w-0 flex-1 px-4 py-3.5 text-left text-sm font-medium ${
                      selectedListId === list.id ? "text-claw-text" : ""
                    }`}
                    style={selectedListId === list.id ? undefined : { color: "var(--text-dim)" }}
                  >
                    <p
                      className={`truncate font-semibold ${selectedListId === list.id ? "text-claw-text" : "text-[var(--text)]"}`}
                    >
                      {list.name}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-mute)" }}>
                      {list.itemCount} {list.itemCount === 1 ? "item" : "items"}
                    </p>
                  </button>
                  {list.kind === "custom" && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(list.id); }}
                      className="mr-2 flex h-7 w-7 flex-none items-center justify-center rounded-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-rose-500/15 hover:text-rose-500 transition-all focus:opacity-100"
                      style={{ color: "var(--text-mute)" }}
                      aria-label={`Delete list ${list.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Create new list */}
        <form onSubmit={handleCreateList} className="mt-3 flex gap-2">
          <input
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder="New list name..."
            aria-label="New list name"
            className="min-w-0 flex-1 rounded-xl border px-3.5 py-2.5 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
            style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
          />
          <button
            type="submit"
            className="rounded-xl bg-claw-500 px-4 py-2.5 text-sm font-semibold text-claw-on hover:bg-claw-600 transition-colors"
          >
            Create
          </button>
        </form>
      </aside>

      {/* Main content area */}
      {/* A plain div, not a second <main>: the shell already owns that landmark
          and a nested one would give the page two. */}
      <div className="min-w-0 flex-1">
        {error && (
          <p className="mb-4 rounded-xl bg-rose-500/5 border border-rose-500/20 px-4 py-3 text-rose-600 text-sm">{error}</p>
        )}

        {!selectedList ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full ring-1" style={{ backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}>
              <FolderOpen className="h-10 w-10" style={{ color: "var(--text-mute)" }} />
            </div>
            <p className={`mt-4 ${SECTION_TITLE}`} style={{ color: "var(--text-dim)" }}>
              {listNotFound ? "That list no longer exists" : "No list selected"}
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-mute)" }}>
              {listNotFound
                ? "It may have been deleted since you saved the link. Pick another from the sidebar."
                : "Select a list from the sidebar or create a new one."}
            </p>
          </div>
        ) : (
          <>
            {/* List header */}
            <div className="mb-5 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                {renamingListId === selectedList.id ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); void handleRenameList(selectedList.id); }}
                    className="flex items-center gap-2"
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      // Blur discards. Committing on blur meant any click, tab
                      // or window switch silently saved a half-typed name, with
                      // no way back to the original. Enter and ✓ commit instead.
                      onBlur={cancelRename}
                      onKeyDown={(e) => { if (e.key === "Escape") cancelRename(); }}
                      aria-label={`Rename list ${selectedList.name}`}
                      className={`min-w-0 flex-1 rounded-lg border px-3 py-1.5 ${PAGE_TITLE} focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15`}
                      style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
                    />
                    <button
                      type="submit"
                      aria-label="Save name"
                      // Keeps focus in the input, so the click isn't cancelled
                      // by its own blur before it lands.
                      onMouseDown={(e) => e.preventDefault()}
                      className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-500/10"
                    >
                      <Check className="h-5 w-5" />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2 className={`truncate ${PAGE_TITLE}`} style={{ color: "var(--text)" }}>{selectedList.name}</h2>
                    <button
                      type="button"
                      onClick={() => { setRenamingListId(selectedList.id); setRenameValue(selectedList.name); }}
                      aria-label="Rename list"
                      className="rounded-lg p-1.5 hover:bg-[var(--surface)] hover:text-[var(--text-dim)] transition-colors"
                      style={{ color: "var(--text-mute)" }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <p className="mt-0.5 text-sm" style={{ color: "var(--text-mute)" }}>
                  {items.length} {items.length === 1 ? "item" : "items"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="ml-3 flex flex-none items-center gap-2 rounded-xl bg-claw-500 px-4 py-2.5 text-sm font-semibold text-claw-on hover:bg-claw-600 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>

            {/* Sort & filter controls */}
            {items.length > 0 && (
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--text-mute)" }} />
                  <input
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    placeholder="Search this list..."
                    aria-label="Search within list"
                    className="w-full rounded-full border py-2 pl-9 pr-3 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
                    style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
                  />
                </div>
                <div
                  role="group"
                  aria-label="Sort items"
                  className="flex flex-none items-center gap-1 rounded-full border p-1"
                  style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}
                >
                  {(Object.entries(SORT_LABELS) as [SortOption, string][]).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSortBy(value)}
                      aria-pressed={sortBy === value}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                        sortBy === value ? "bg-claw-500 text-claw-on" : "hover:text-[var(--text)]"
                      }`}
                      style={sortBy === value ? undefined : { color: "var(--text-mute)" }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Items grid */}
            {loadingItems ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i}>
                    <div className="skeleton rounded-xl" style={{ aspectRatio: "2/3" }} />
                    <div className="skeleton mt-2 h-4 w-3/4 rounded" />
                    <div className="skeleton mt-1 h-3 w-1/2 rounded" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full ring-1" style={{ backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}>
                  <FolderOpen className="h-10 w-10" style={{ color: "var(--text-mute)" }} />
                </div>
                <p className={`mt-4 ${SECTION_TITLE}`} style={{ color: "var(--text-dim)" }}>This list is empty</p>
                <p className="mt-1 text-sm" style={{ color: "var(--text-mute)" }}>
                  Click <span className="font-semibold text-claw-text">+ Add</span> to search and add titles.
                </p>
              </div>
            ) : displayedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full ring-1" style={{ backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}>
                  <Search className="h-10 w-10" style={{ color: "var(--text-mute)" }} />
                </div>
                <p className={`mt-4 ${SECTION_TITLE}`} style={{ color: "var(--text-dim)" }}>No matches</p>
                <p className="mt-1 text-sm" style={{ color: "var(--text-mute)" }}>Try a different search term.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {visibleItems.map((item, index) => {
                  const name = itemName(item);
                  const poster = item.metadata?.poster;
                  const year = item.metadata?.year;
                  return (
                    <div key={`${item.type}:${item.imdbId}`} className="group relative">
                      {/* Poster */}
                      <button
                        type="button"
                        onClick={() => setSelectedItem(toSearchResult(item, selectedList))}
                        className="card-lift relative block w-full overflow-hidden rounded-xl text-left ring-1"
                        style={{ aspectRatio: "2/3", backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}
                        aria-label={`Open details for ${name}`}
                      >
                        {poster ? (
                          <img
                            src={poster}
                            srcSet={buildTmdbSrcSet(poster)}
                            sizes={POSTER_GRID_SIZES}
                            alt={name}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading={index < 5 ? "eager" : "lazy"}
                            fetchPriority={index < 5 ? "high" : "low"}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--surface)] to-[var(--surface-strong)]">
                            <Film className="h-10 w-10" style={{ color: "var(--text-mute)" }} />
                          </div>
                        )}
                        {/* Type badge */}
                        <span
                          className={`absolute top-2.5 left-2.5 rounded-md px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide shadow-lg ring-1 ring-black/15 ${
                            item.type === "movie"
                              ? "bg-claw-500 text-claw-on"
                              : "bg-plum-500/90 text-white"
                          }`}
                          style={item.type === "movie" ? undefined : { textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
                        >
                          {item.type === "movie" ? "Movie" : "Series"}
                        </span>
                        {/* Hover overlay with gradient */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 transition-opacity duration-300 sm:opacity-0 sm:group-hover:opacity-100" />
                      </button>
                      {/* Remove button on hover */}
                      <button
                        type="button"
                        disabled={removingIds[item.imdbId]}
                        onClick={() => handleRemove(item)}
                        className="absolute top-2.5 right-2.5 z-10 rounded-full bg-black/60 p-2 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 transition-all duration-200 hover:bg-rose-500 hover:text-white disabled:opacity-50 backdrop-blur-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-ring-offset"
                        aria-label="Remove from list"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      {/* Title & year */}
                      <p className="mt-2.5 truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{name}</p>
                      <p className="text-xs" style={{ color: "var(--text-mute)" }}>{year ?? "Unknown year"}</p>
                    </div>
                  );
                })}
              </div>
            )}
            {!loadingItems && renderLimit < displayedItems.length && <div ref={sentinelRef} className="h-4" />}
          </>
        )}
      </div>

      {/* Add item modal */}
      {showAddModal && selectedListId && selectedList && (
        <AddItemModal
          listId={selectedListId}
          listName={selectedList.name}
          existingKeys={existingItemKeys}
          onClose={() => setShowAddModal(false)}
          onAdded={() => void loadItems(selectedListId)}
        />
      )}

      {/* Detail panel */}
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
