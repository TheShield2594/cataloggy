import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Film, Tv } from "lucide-react";
import { api, CatalogList, MediaType, SearchResult } from "../api";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<MediaType>("movie");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [lists, setLists] = useState<CatalogList[]>([]);
  const [selectedListIds, setSelectedListIds] = useState<Record<string, string>>({});
  const [pendingAdds, setPendingAdds] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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

  const watchlistId = useMemo(() => lists.find((list) => list.kind === "watchlist")?.id, [lists]);

  const watchlistImdbIds = useMemo(() => {
    const watchlist = lists.find((l) => l.kind === "watchlist");
    return new Set(watchlist?.items.map((i) => i.imdbId) ?? []);
  }, [lists]);

  const doSearch = useCallback(async (searchType: MediaType, searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setMessage(null);
    setError(null);
    setIsSearching(true);
    setSelectedListIds({});

    try {
      const response = await api.search(searchType, searchQuery);
      setResults(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced auto-search
  useEffect(() => {
    if (!query.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doSearch(type, query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, type, doSearch]);

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await doSearch(type, query);
  };

  const handleAdd = async (listId: string, result: SearchResult) => {
    const key = `${listId}:${result.imdbId}`;
    if (pendingAdds[key]) return;

    setMessage(null);
    setError(null);
    setPendingAdds((current) => ({ ...current, [key]: true }));

    try {
      await api.addToList(listId, { type: result.type, imdbId: result.imdbId, title: result.name });
      setMessage(`Added ${result.name}`);
      if (listId === watchlistId) {
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? { ...l, items: [...l.items, { listId, type: result.type, imdbId: result.imdbId, addedAt: new Date().toISOString() }] }
              : l
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add item");
    } finally {
      setPendingAdds((current) => ({ ...current, [key]: false }));
    }
  };

  return (
    <div className="space-y-4">
      {/* Sticky search bar */}
      <form onSubmit={submitSearch} className="sticky top-16 z-40 flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900/95 backdrop-blur p-4">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search TMDB titles"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          required
        />
        {/* Sliding pill segmented control */}
        <div className="relative inline-flex rounded-full bg-slate-800 p-1">
          <div
            className="absolute top-1 h-[calc(100%-0.5rem)] w-[calc(50%-0.25rem)] rounded-full bg-sky-500 transition-transform duration-200"
            style={{ transform: type === "series" ? "translateX(100%)" : "translateX(0)" }}
          />
          {(["movie", "series"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setType(option)}
              className={`relative z-10 flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium ${
                type === option ? "text-white" : "text-slate-400"
              }`}
            >
              {option === "movie" ? <Film className="h-3.5 w-3.5" /> : <Tv className="h-3.5 w-3.5" />}
              {option === "movie" ? "Movie" : "Series"}
            </button>
          ))}
        </div>
        <button type="submit" disabled={isSearching} className="rounded-lg bg-sky-600 px-4 py-2 font-medium hover:bg-sky-500 disabled:opacity-50">
          {isSearching ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-4 py-2 text-rose-300">{error}</p>}
      {message && <p className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-2 text-emerald-300">{message}</p>}

      {results !== null && results.length === 0 && (
        <p className="py-8 text-center text-slate-400">No results found.</p>
      )}

      {/* Poster grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {(results ?? []).map((result) => {
          const inWatchlist = watchlistImdbIds.has(result.imdbId);
          const resultListId = selectedListIds[result.imdbId] ?? lists[0]?.id ?? "";
          const watchlistPendingKey = `${watchlistId}:${result.imdbId}`;
          const listPendingKey = `${resultListId}:${result.imdbId}`;

          return (
            <div key={`${result.type}:${result.imdbId}`} className="group">
              {/* Poster */}
              <div className="relative overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10" style={{ aspectRatio: "var(--poster-ratio)" }}>
                <img
                  src={result.poster ?? "https://placehold.co/120x180?text=No+Poster"}
                  alt={result.name}
                  className="h-full w-full object-cover"
                />
                {/* In-watchlist checkmark overlay */}
                {inWatchlist && (
                  <div className="absolute top-1.5 right-1.5 z-10 rounded-full bg-emerald-500 p-1 shadow">
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  </div>
                )}
                {/* Hover overlay with actions */}
                <div className="absolute inset-0 flex flex-col items-center justify-end bg-gradient-to-t from-black/80 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-3">
                  <div className="flex w-full flex-col gap-1.5">
                    <button
                      type="button"
                      disabled={!watchlistId || inWatchlist || pendingAdds[watchlistPendingKey]}
                      onClick={() => watchlistId && handleAdd(watchlistId, result)}
                      className="w-full rounded-lg bg-sky-600 px-2 py-1.5 text-xs font-medium disabled:opacity-50 hover:bg-sky-500"
                    >
                      {inWatchlist ? "In Watchlist" : "+ Watchlist"}
                    </button>
                    <div className="flex gap-1">
                      <select
                        value={resultListId}
                        onChange={(event) =>
                          setSelectedListIds((prev) => ({ ...prev, [result.imdbId]: event.target.value }))
                        }
                        className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-800 px-1.5 py-1 text-2xs"
                      >
                        {lists.map((list) => (
                          <option key={list.id} value={list.id}>
                            {list.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!resultListId || pendingAdds[listPendingKey]}
                        onClick={() => resultListId && handleAdd(resultListId, result)}
                        className="rounded-lg bg-violet-600 px-2 py-1 text-2xs font-medium disabled:opacity-50 hover:bg-violet-500"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              {/* Title & year */}
              <p className="mt-1.5 truncate text-sm font-medium">{result.name}</p>
              <p className="text-xs text-slate-500">{result.year ?? "Unknown year"}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
