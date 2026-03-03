import { FormEvent, useEffect, useMemo, useState } from "react";
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

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setIsSearching(true);
    setSelectedListIds({});

    try {
      const response = await api.search(type, query);
      setResults(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
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
      <form onSubmit={submitSearch} className="flex flex-wrap gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search TMDB titles"
          className="min-w-64 flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2"
          required
        />
        <div className="inline-flex rounded border border-slate-700 p-1">
          {(["movie", "series"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setType(option)}
              className={`rounded px-3 py-1 text-sm ${type === option ? "bg-sky-500 text-white" : "text-slate-300"}`}
            >
              {option}
            </button>
          ))}
        </div>
        <button type="submit" disabled={isSearching} className="rounded bg-sky-600 px-4 py-2 font-medium disabled:opacity-50">
          {isSearching ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="text-rose-300">{error}</p>}
      {message && <p className="text-emerald-300">{message}</p>}

      {results !== null && results.length === 0 && (
        <p className="text-slate-400">No results found.</p>
      )}

      <ul className="space-y-3">
        {(results ?? []).map((result) => {
          const inWatchlist = watchlistImdbIds.has(result.imdbId);
          const resultListId = selectedListIds[result.imdbId] ?? lists[0]?.id ?? "";
          const watchlistPendingKey = `${watchlistId}:${result.imdbId}`;
          const listPendingKey = `${resultListId}:${result.imdbId}`;

          return (
            <li key={`${result.type}:${result.imdbId}`} className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 md:flex-row">
              <img
                src={result.poster ?? "https://placehold.co/120x180?text=No+Poster"}
                alt={result.name}
                className="h-36 w-24 rounded object-cover"
              />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-semibold">{result.name}</p>
                  {inWatchlist && (
                    <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-xs text-emerald-300">
                      In Watchlist
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-400">{result.year ?? "Unknown year"}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!watchlistId || inWatchlist || pendingAdds[watchlistPendingKey]}
                    onClick={() => watchlistId && handleAdd(watchlistId, result)}
                    className="rounded bg-sky-600 px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {inWatchlist ? "In Watchlist" : "Add to Watchlist"}
                  </button>
                  <select
                    value={resultListId}
                    onChange={(event) =>
                      setSelectedListIds((prev) => ({ ...prev, [result.imdbId]: event.target.value }))
                    }
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
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
                    className="rounded bg-violet-600 px-3 py-2 text-sm disabled:opacity-50"
                  >
                    Add to List…
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
