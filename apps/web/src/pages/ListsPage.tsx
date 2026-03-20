import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Film, FolderOpen, Plus, Search, Trash2, Tv, X } from "lucide-react";
import { api, CatalogList, ListItemWithMeta, MediaType, SearchResult } from "../api";

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

  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

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
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-item-modal-title"
        className="w-full max-w-lg rounded-2xl border border-slate-800/60 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
          <h3 id="add-item-modal-title" className="text-lg font-bold">Add to {listName}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="flex gap-2 border-b border-slate-800/60 px-5 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movies & series..."
              aria-label="Search movies and series"
              className="w-full rounded-full border border-slate-700/60 bg-slate-900 py-2.5 pl-9 pr-3 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/15"
            />
          </div>
          <div className="relative inline-flex rounded-full bg-slate-800 p-0.5 border border-slate-700/40">
            <div
              className="absolute top-0.5 h-[calc(100%-0.25rem)] w-[calc(50%-0.125rem)] rounded-full bg-red-500 transition-transform duration-200"
              style={{ transform: type === "series" ? "translateX(100%)" : "translateX(0)" }}
            />
            {(["movie", "series"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setType(opt)}
                className={`relative z-10 flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium ${type === opt ? "text-white" : "text-slate-400"}`}
              >
                {opt === "movie" ? <Film className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                {opt === "movie" ? "Movie" : "Series"}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto px-5 py-3">
          {error && <p className="mb-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-300">{error}</p>}
          {searching && <p className="py-6 text-center text-sm text-slate-400">Searching...</p>}
          {!searching && query.trim() && results.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">No results found.</p>
          )}
          <div className="space-y-1">
            {results.map((r) => (
              <button
                key={`${r.type}:${r.imdbId}`}
                type="button"
                disabled={adding[r.imdbId]}
                onClick={() => handleAdd(r)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-slate-900/80 disabled:opacity-50 transition-colors"
              >
                <div className="h-14 w-10 flex-none overflow-hidden rounded-lg bg-slate-800 ring-1 ring-white/5">
                  {r.poster ? (
                    <img src={r.poster} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center"><Film className="h-4 w-4 text-slate-500" /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-200">{r.name}</p>
                  <p className="text-xs text-slate-400">{r.year ?? "Unknown"} &middot; {r.type}</p>
                </div>
                <Plus className="h-4 w-4 flex-none text-red-400" />
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      {/* Sidebar */}
      <aside className="w-full shrink-0 lg:w-64">
        {/* Mobile: horizontal scrollable tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide lg:flex-col lg:overflow-x-visible lg:pb-0">
          {lists.map((list) => (
            <div key={list.id} className="relative flex-none lg:w-full">
              {confirmDeleteId === list.id && list.kind === "custom" ? (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 flex-none text-rose-400" />
                    <p className="text-xs font-semibold text-rose-300">Delete "{list.name}"?</p>
                  </div>
                  <p className="text-xs text-slate-400 mb-3">This will remove the list and all its items.</p>
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
                      className="flex-1 rounded-lg border border-slate-700/60 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`group flex items-center rounded-xl border transition-all lg:w-full ${
                  selectedListId === list.id
                    ? "border-red-500/40 bg-red-500/10 shadow-lg shadow-red-500/5"
                    : "border-slate-800/60 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/70"
                }`}>
                  <button
                    type="button"
                    onClick={() => setSelectedListId(list.id)}
                    className={`min-w-0 flex-1 px-4 py-3.5 text-left text-sm font-medium ${
                      selectedListId === list.id ? "text-red-300" : "text-slate-300"
                    }`}
                  >
                    <p className="truncate font-semibold">{list.name}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {list.itemCount} {list.itemCount === 1 ? "item" : "items"}
                    </p>
                  </button>
                  {list.kind === "custom" && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(list.id); }}
                      className="mr-2 flex h-7 w-7 flex-none items-center justify-center rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:bg-rose-500/15 hover:text-rose-400 transition-all focus:opacity-100"
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
            className="min-w-0 flex-1 rounded-xl border border-slate-700/60 bg-slate-900 px-3.5 py-2.5 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/15"
          />
          <button
            type="submit"
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold hover:bg-emerald-500 transition-colors"
          >
            Create
          </button>
        </form>
      </aside>

      {/* Main content area */}
      <main className="min-w-0 flex-1">
        {error && (
          <p className="mb-4 rounded-xl bg-rose-500/5 border border-rose-500/20 px-4 py-3 text-rose-300 text-sm">{error}</p>
        )}

        {!selectedList ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-900 ring-1 ring-slate-800">
              <FolderOpen className="h-10 w-10 text-slate-700" />
            </div>
            <p className="mt-4 text-lg font-semibold text-slate-400">No list selected</p>
            <p className="mt-1 text-sm text-slate-400">Select a list from the sidebar or create a new one.</p>
          </div>
        ) : (
          <>
            {/* List header */}
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white">{selectedList.name}</h2>
                <p className="mt-0.5 text-sm text-slate-400">
                  {items.length} {items.length === 1 ? "item" : "items"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>

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
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-900 ring-1 ring-slate-800">
                  <FolderOpen className="h-10 w-10 text-slate-700" />
                </div>
                <p className="mt-4 text-lg font-semibold text-slate-400">This list is empty</p>
                <p className="mt-1 text-sm text-slate-400">
                  Click <span className="font-semibold text-red-400">+ Add</span> to search and add titles.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {items.map((item) => {
                  const name = item.metadata?.name ?? item.imdbId;
                  const poster = item.metadata?.poster;
                  const year = item.metadata?.year;
                  return (
                    <div key={`${item.type}:${item.imdbId}`} className="group">
                      {/* Poster */}
                      <div className="card-lift relative overflow-hidden rounded-xl bg-slate-800 ring-1 ring-white/10" style={{ aspectRatio: "2/3" }}>
                        {poster ? (
                          <img src={poster} alt={name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                            <Film className="h-10 w-10 text-slate-500" />
                          </div>
                        )}
                        {/* Type badge */}
                        <span className={`absolute top-2.5 left-2.5 rounded-md px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide shadow-lg ${
                          item.type === "movie"
                            ? "bg-red-500/90 text-white"
                            : "bg-violet-600/90 text-white"
                        }`}>
                          {item.type === "movie" ? "Movie" : "Series"}
                        </span>
                        {/* Hover overlay with gradient */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                        {/* Remove button on hover */}
                        <button
                          type="button"
                          disabled={removingIds[item.imdbId]}
                          onClick={() => handleRemove(item)}
                          className="absolute top-2.5 right-2.5 rounded-full bg-black/60 p-2 text-slate-300 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 transition-all duration-200 hover:bg-rose-500 hover:text-white disabled:opacity-50 backdrop-blur-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                          aria-label="Remove from list"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      {/* Title & year */}
                      <p className="mt-2.5 truncate text-sm font-semibold text-slate-100">{name}</p>
                      <p className="text-xs text-slate-400">{year ?? "Unknown year"}</p>
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
    </div>
  );
}
