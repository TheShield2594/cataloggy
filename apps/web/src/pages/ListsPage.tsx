import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Film, FolderOpen, Pencil, Plus, Search, Trash2, Tv, X } from "lucide-react";
import { api, CatalogList, ListItemWithMeta, MediaType, SearchResult } from "../api";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useToast } from "../hooks/useToast";
import { useScrollLock } from "../hooks/useScrollLock";
import { useEscapeKey } from "../hooks/useEscapeKey";

type SortOption = "added" | "name" | "year" | "rating";

const SORT_LABELS: Record<SortOption, string> = {
  added: "Date Added",
  name: "Name",
  year: "Year",
  rating: "Rating",
};

function toSearchResult(item: ListItemWithMeta, list?: CatalogList): SearchResult {
  return {
    imdbId: item.imdbId,
    type: item.type,
    name: item.metadata?.name ?? item.imdbId,
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

function AddItemModal({
  listId,
  listName,
  onClose,
  onAdded,
}: {
  listId: string;
  listName: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<MediaType>("movie");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useScrollLock();
  useEscapeKey(onClose);

  const doSearch = useCallback(async (q: string, t: MediaType) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const res = await api.search(t, q);
      setResults(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doSearch(query, type), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, type, doSearch]);

  const handleAdd = async (result: SearchResult) => {
    if (adding[result.imdbId]) return;
    setAdding((prev) => ({ ...prev, [result.imdbId]: true }));
    try {
      await api.addToList(listId, { type: result.type, imdbId: result.imdbId, title: result.name });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item");
    } finally {
      setAdding((prev) => ({ ...prev, [result.imdbId]: false }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm pt-[10vh]" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-item-modal-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border shadow-sm"
        style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <h3 id="add-item-modal-title" className="text-lg font-bold" style={{ color: "var(--text)" }}>Add to {listName}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="rounded-lg p-1.5 hover:bg-[var(--surface)] hover:text-[var(--text)]" style={{ color: "var(--text-mute)" }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="flex gap-2 border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
          <div className="relative flex-1">
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
          <div className="relative inline-flex rounded-full p-0.5 border" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div
              className="absolute top-0.5 h-[calc(100%-0.25rem)] w-[calc(50%-0.125rem)] rounded-full bg-claw-500 transition-transform duration-200"
              style={{ transform: type === "series" ? "translateX(100%)" : "translateX(0)" }}
            />
            {(["movie", "series"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setType(opt)}
                className="relative z-10 flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium"
                style={{ color: type === opt ? "#fff" : "var(--text-dim)" }}
              >
                {opt === "movie" ? <Film className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                {opt === "movie" ? "Movie" : "Series"}
              </button>
            ))}
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
            {results.map((r) => (
              <button
                key={`${r.type}:${r.imdbId}`}
                type="button"
                disabled={adding[r.imdbId]}
                onClick={() => handleAdd(r)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-[var(--surface)] disabled:opacity-50 transition-colors"
              >
                <div className="h-14 w-10 flex-none overflow-hidden rounded-lg ring-1" style={{ backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}>
                  {r.poster ? (
                    <img src={r.poster} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center"><Film className="h-4 w-4" style={{ color: "var(--text-mute)" }} /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{r.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-mute)" }}>{r.year ?? "Unknown"} &middot; {r.type}</p>
                </div>
                <Plus className="h-4 w-4 flex-none text-claw-600" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ListsPage() {
  const [lists, setLists] = useState<CatalogList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
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
  const { showToast } = useToast();
  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading } = useDetailPanel();

  const loadLists = useCallback(async () => {
    try {
      const { lists: loaded } = await api.getLists();
      setLists(loaded);
      return loaded;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lists");
      return [];
    }
  }, []);

  const loadItems = useCallback(async (listId: string) => {
    setLoadingItems(true);
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
    void loadLists().then((loaded) => {
      if (loaded.length > 0 && !selectedListId) {
        setSelectedListId(loaded[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (selectedListId) {
      void loadItems(selectedListId);
    } else {
      setItems([]);
    }
  }, [selectedListId, loadItems]);

  const selectedList = lists.find((l) => l.id === selectedListId);

  const handleCreateList = async (e: FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    try {
      const { list } = await api.createList(newListName.trim());
      setNewListName("");
      await loadLists();
      setSelectedListId(list.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create list");
    }
  };

  const handleDeleteList = async (listId: string) => {
    setDeletingListId(listId);
    try {
      await api.deleteList(listId);
      setConfirmDeleteId(null);
      if (selectedListId === listId) setSelectedListId(null);
      await loadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete list");
    } finally {
      setDeletingListId(null);
    }
  };

  const handleRenameList = async (listId: string) => {
    const name = renameValue.trim();
    if (!name) {
      setRenamingListId(null);
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

  const displayedItems = useMemo(() => {
    let result = items;
    const q = filterQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((item) => (item.metadata?.name ?? item.imdbId).toLowerCase().includes(q));
    }
    const sorted = [...result];
    switch (sortBy) {
      case "name":
        sorted.sort((a, b) => (a.metadata?.name ?? a.imdbId).localeCompare(b.metadata?.name ?? b.imdbId));
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

  const handleRemove = async (item: ListItemWithMeta) => {
    if (!selectedListId || removingIds[item.imdbId]) return;
    setRemovingIds((prev) => ({ ...prev, [item.imdbId]: true }));
    try {
      await api.removeFromList(selectedListId, { type: item.type, imdbId: item.imdbId });
      setItems((prev) => prev.filter((i) => i.imdbId !== item.imdbId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove item");
    } finally {
      setRemovingIds((prev) => ({ ...prev, [item.imdbId]: false }));
    }
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-8">
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
                    : "hover:bg-[var(--surface)] hover:border-[var(--border-strong)]"
                }`}
                style={{
                  borderColor: selectedListId === list.id ? undefined : "var(--border)",
                  background: selectedListId === list.id ? undefined : "var(--bg-1)",
                }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedListId(list.id)}
                    className={`min-w-0 flex-1 px-4 py-3.5 text-left text-sm font-medium ${
                      selectedListId === list.id ? "text-claw-600" : ""
                    }`}
                    style={selectedListId === list.id ? undefined : { color: "var(--text-dim)" }}
                  >
                    <p className="truncate font-semibold" style={{ color: "var(--text)" }}>{list.name}</p>
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
            className="min-w-0 flex-1 rounded-xl border px-3.5 py-2.5 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
            style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
          />
          <button
            type="submit"
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
          >
            Create
          </button>
        </form>
      </aside>

      {/* Main content area */}
      <main className="min-w-0 flex-1">
        {error && (
          <p className="mb-4 rounded-xl bg-rose-500/5 border border-rose-500/20 px-4 py-3 text-rose-600 text-sm">{error}</p>
        )}

        {!selectedList ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full ring-1" style={{ backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}>
              <FolderOpen className="h-10 w-10" style={{ color: "var(--text-mute)" }} />
            </div>
            <p className="mt-4 text-lg font-semibold" style={{ color: "var(--text-dim)" }}>No list selected</p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-mute)" }}>Select a list from the sidebar or create a new one.</p>
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
                      onBlur={() => void handleRenameList(selectedList.id)}
                      className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-2xl font-bold focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
                      style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
                    />
                    <button type="submit" aria-label="Save name" className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-500/10">
                      <Check className="h-5 w-5" />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-2xl font-bold" style={{ color: "var(--text)" }}>{selectedList.name}</h2>
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
                className="ml-3 flex flex-none items-center gap-2 rounded-xl bg-claw-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-claw-600 transition-colors"
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
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  aria-label="Sort items"
                  className="rounded-full border px-3.5 py-2 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
                  style={{ borderColor: "var(--border)", color: "var(--text-dim)", background: "var(--bg-1)" }}
                >
                  {Object.entries(SORT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>Sort: {label}</option>
                  ))}
                </select>
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
                <p className="mt-4 text-lg font-semibold" style={{ color: "var(--text-dim)" }}>This list is empty</p>
                <p className="mt-1 text-sm" style={{ color: "var(--text-mute)" }}>
                  Click <span className="font-semibold text-claw-600">+ Add</span> to search and add titles.
                </p>
              </div>
            ) : displayedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full ring-1" style={{ backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}>
                  <Search className="h-10 w-10" style={{ color: "var(--text-mute)" }} />
                </div>
                <p className="mt-4 text-lg font-semibold" style={{ color: "var(--text-dim)" }}>No matches</p>
                <p className="mt-1 text-sm" style={{ color: "var(--text-mute)" }}>Try a different search term.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {displayedItems.map((item, index) => {
                  const name = item.metadata?.name ?? item.imdbId;
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
                          <img src={poster} alt={name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading={index < 5 ? "eager" : "lazy"} />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--surface)] to-[var(--surface-strong)]">
                            <Film className="h-10 w-10" style={{ color: "var(--text-mute)" }} />
                          </div>
                        )}
                        {/* Type badge */}
                        <span className={`absolute top-2.5 left-2.5 rounded-md px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide shadow-lg ${
                          item.type === "movie"
                            ? "bg-claw-500/90 text-white"
                            : "bg-plum-500/90 text-white"
                        }`}>
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
                        className="absolute top-2.5 right-2.5 z-10 rounded-full bg-black/60 p-2 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 transition-all duration-200 hover:bg-rose-500 hover:text-white disabled:opacity-50 backdrop-blur-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2"
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
          </>
        )}
      </main>

      {/* Add item modal */}
      {showAddModal && selectedListId && selectedList && (
        <AddItemModal
          listId={selectedListId}
          listName={selectedList.name}
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
          listMap={new Map(lists.map((l) => [l.id, l]))}
          onClose={() => setSelectedItem(null)}
          onShowToast={showToast}
          onHistoryChange={(events) => setPanelHistory(events)}
        />
      )}
    </div>
  );
}
