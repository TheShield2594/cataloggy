import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Check, Clock, Gamepad2, Plus, RefreshCw, Search, Star, X } from "lucide-react";
import { api, Game, GameSearchResult, GameSort, SteamStatus } from "../api";
import { GameDetailPanel } from "../components/GameDetailPanel";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useScrollLock } from "../hooks/useScrollLock";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useToast } from "../hooks/useToast";
import { preconnectToGameArtwork } from "../utils/preconnect";
import { useCachedState } from "../hooks/useCachedState";
import { formatPlaytime } from "../utils/playtime";
import { formatRating, ratingLabel, RATING_MAX } from "../utils/rating";

const SORT_OPTIONS: { value: GameSort; label: string }[] = [
  { value: "recent", label: "Recently Played" },
  { value: "playtime", label: "Playtime" },
  { value: "rating", label: "Rating" },
];

// Mirrors the server's sortToOrderBy (routes/games.ts) so a locally-added or
// -updated game lands in the right spot instead of just being pinned to
// wherever the mutation happened to place it.
function compareGames(a: Game, b: Game, sort: GameSort): number {
  switch (sort) {
    case "playtime":
      return b.playtimeMinutes - a.playtimeMinutes;
    case "rating":
      return (b.rating ?? -Infinity) - (a.rating ?? -Infinity);
    case "recent":
    default: {
      const aTime = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : -Infinity;
      const bTime = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : -Infinity;
      return bTime - aTime;
    }
  }
}

/* ─── Add Game Modal (search-to-add via IGDB) ─────────────── */

function AddGameModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (game: Game) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GameSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useScrollLock();
  useEscapeKey(onClose);

  // Cancel any still-in-flight search when the modal unmounts, so its response
  // can't land after the fact.
  useEffect(() => () => abortRef.current?.abort(), []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearching(true);
    setError(null);
    try {
      const res = await api.searchGames(q, controller.signal);
      setResults(res);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      if (abortRef.current === controller) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setResults([]);
      setSearching(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doSearch(query), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  const handleAdd = async (result: GameSearchResult) => {
    if (adding[result.igdbId] || result.inLibrary) return;
    setAdding((prev) => ({ ...prev, [result.igdbId]: true }));
    try {
      const { game } = await api.addGame({
        igdbId: result.igdbId,
        title: result.title,
        coverUrl: result.coverUrl,
        releaseDate: result.releaseDate,
        genres: result.genres,
      });
      setResults((prev) => prev.map((r) => (r.igdbId === result.igdbId ? { ...r, inLibrary: true } : r)));
      onAdded(game);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add game");
    } finally {
      setAdding((prev) => ({ ...prev, [result.igdbId]: false }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm pt-[10vh]" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-game-modal-title"
        tabIndex={-1}
        className="glass-surface w-full max-w-lg rounded-2xl border shadow-sm"
        style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <h3 id="add-game-modal-title" className="text-lg font-bold" style={{ color: "var(--text)" }}>Add a game</h3>
          <button onClick={onClose} aria-label="Close dialog" className="rounded-lg p-1.5 hover:bg-[var(--surface)] hover:text-[var(--text)]" style={{ color: "var(--text-mute)" }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--text-mute)" }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search games on IGDB..."
              aria-label="Search games"
              className="w-full rounded-full border py-2.5 pl-9 pr-3 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}
            />
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-5 py-3">
          {error && <p className="mb-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-600">{error}</p>}
          {searching && <p className="py-6 text-center text-sm" style={{ color: "var(--text-mute)" }}>Searching...</p>}
          {!searching && query.trim() && results.length === 0 && !error && (
            <p className="py-6 text-center text-sm" style={{ color: "var(--text-mute)" }}>No results found.</p>
          )}
          <div className="space-y-1">
            {results.map((r) => (
              <button
                key={r.igdbId}
                type="button"
                disabled={adding[r.igdbId] || r.inLibrary}
                onClick={() => void handleAdd(r)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-[var(--surface)] disabled:opacity-50 transition-colors"
              >
                <div className="h-14 w-10 flex-none overflow-hidden rounded-lg ring-1" style={{ backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}>
                  {r.coverUrl ? (
                    <img src={r.coverUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center"><Gamepad2 className="h-4 w-4" style={{ color: "var(--text-mute)" }} /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{r.title}</p>
                  <p className="text-xs" style={{ color: "var(--text-mute)" }}>
                    {r.releaseDate ? new Date(r.releaseDate).getFullYear() : "Unknown"}
                    {r.genres.length > 0 ? ` · ${r.genres.slice(0, 2).join(", ")}` : ""}
                  </p>
                </div>
                {r.inLibrary ? (
                  <Check className="h-4 w-4 flex-none text-emerald-600" />
                ) : (
                  <Plus className="h-4 w-4 flex-none text-claw-text" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Game Card ────────────────────────────────────────────── */

function GameCard({ game, onSelect }: { game: Game; onSelect: (game: Game) => void }) {
  return (
    <div className="group flex flex-col">
      <div
        role="button"
        tabIndex={0}
        className="card-lift relative cursor-pointer overflow-hidden rounded-xl ring-1 ring-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
        style={{ aspectRatio: "var(--poster-ratio)" }}
        onClick={() => onSelect(game)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(game);
          }
        }}
        aria-label={`View details for ${game.title}`}
      >
        {game.coverUrl ? (
          <img
            src={game.coverUrl}
            alt={game.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br" style={{ "--tw-gradient-from": "var(--surface)", "--tw-gradient-to": "var(--surface-strong)" } as React.CSSProperties}>
            <Gamepad2 className="h-12 w-12" style={{ color: "var(--text-mute)" }} />
          </div>
        )}

        {game.finished && (
          <span className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md bg-emerald-500/90 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-white shadow-lg">
            <Check className="h-3 w-3" /> Finished
          </span>
        )}
      </div>

      <div className="mt-3">
        <p className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{game.title}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-mute)" }}>
            <Clock className="h-3 w-3" /> {formatPlaytime(game.playtimeMinutes)}
          </span>
          {game.rating != null && (
            <span className="flex items-center gap-0.5 text-xs text-amber-600" title={ratingLabel(game.rating)}>
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
              {formatRating(game.rating)}
              <span style={{ color: "var(--text-mute)" }}>/{RATING_MAX}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Steam status bar ────────────────────────────────────── */

function SteamStatusBar({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<SteamStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    void (async () => {
      try {
        setStatus(await api.getSteamStatus());
      } catch {
        setStatus(null);
      }
    })();
  }, []);

  if (!status || !status.configured) return null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const summary = await api.triggerSteamSync();
      showToast(`Steam sync complete: ${summary.created} added, ${summary.updated} updated`, "success");
      onSynced();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Steam sync failed", "error");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      className="mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <span style={{ color: "var(--text-dim)" }}>
        Steam {status.player ? <>connected as <strong style={{ color: "var(--text)" }}>{status.player.username}</strong></> : "connected"}
      </span>
      <button
        type="button"
        onClick={() => void handleSync()}
        disabled={syncing}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--surface-strong)] disabled:opacity-50"
        style={{ color: "var(--text-dim)" }}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Syncing..." : "Sync now"}
      </button>
    </div>
  );
}

/* ─── Main Page ────────────────────────────────────────────── */

export function GamesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = (SORT_OPTIONS.some((o) => o.value === searchParams.get("sort")) ? searchParams.get("sort") : "recent") as GameSort;

  // Keyed by sort order: the list is a different answer per sort, so caching
  // them separately makes flipping back to one already seen instant.
  const [games, setGames, gamesMeta] = useCachedState<Game[] | null>(`games:${sort}`, null);

  // Covers come from IGDB and Steam rather than TMDB, so this is the first point
  // at which those connections are worth opening.
  useEffect(() => { preconnectToGameArtwork(); }, []);
  const [loading, setLoading] = useState(!gamesMeta.hadCachedValue);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const { showToast } = useToast();
  const loadAbortRef = useRef<AbortController | null>(null);

  const loadGames = useCallback(async (currentSort: GameSort) => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const loaded = await api.listGames(currentSort, controller.signal);
      if (loadAbortRef.current !== controller) return;
      setGames(loaded);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load games");
    } finally {
      if (loadAbortRef.current === controller) setLoading(false);
    }
    // `setGames` is bound to the current sort's cache key, so it has to be a
    // dependency — otherwise every sort's results are written under `games:recent`.
  }, [setGames]);

  useEffect(() => {
    void loadGames(sort);
    return () => loadAbortRef.current?.abort();
  }, [sort, loadGames]);

  const handleGameAdded = (game: Game) => {
    setGames((prev) => (prev ? [...prev, game].sort((a, b) => compareGames(a, b, sort)) : [game]));
    showToast(`Added ${game.title}`, "success");
  };

  const handleGameUpdated = (game: Game) => {
    setGames((prev) =>
      prev ? prev.map((g) => (g.id === game.id ? game : g)).sort((a, b) => compareGames(a, b, sort)) : prev
    );
    setSelectedGame(game);
  };

  const handleGameDeleted = (id: string) => {
    setGames((prev) => prev?.filter((g) => g.id !== id) ?? prev);
    setSelectedGame(null);
  };

  const emptyState = useMemo(
    () => games !== null && games.length === 0 && !loading,
    [games, loading]
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Games</h1>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-claw-500 px-3.5 py-2 text-sm font-semibold text-claw-on transition-colors hover:bg-claw-600"
        >
          <Plus className="h-4 w-4" /> Add game
        </button>
      </div>

      <SteamStatusBar onSynced={() => void loadGames(sort)} />

      <div className="mb-5 flex items-center gap-1.5 rounded-full border p-1 w-fit" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              if (opt.value === "recent") next.delete("sort");
              else next.set("sort", opt.value);
              return next;
            }, { replace: true })}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${sort === opt.value ? "bg-claw-500 text-claw-on" : ""}`}
            style={sort === opt.value ? undefined : { color: "var(--text-mute)" }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-600">{error}</p>
      )}

      {loading && (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="skeleton rounded-xl" style={{ aspectRatio: "var(--poster-ratio)" }} />
          ))}
        </div>
      )}

      {emptyState && (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <Gamepad2 className="h-12 w-12" style={{ color: "var(--text-mute)" }} />
          <p style={{ color: "var(--text-dim)" }}>No games in your library yet.</p>
          <p className="text-sm" style={{ color: "var(--text-mute)" }}>
            Add one manually, or connect Steam to sync your library automatically.
          </p>
        </div>
      )}

      {!loading && games && games.length > 0 && (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {games.map((game) => (
            <GameCard key={game.id} game={game} onSelect={setSelectedGame} />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddGameModal
          onClose={() => setShowAddModal(false)}
          onAdded={handleGameAdded}
        />
      )}

      {selectedGame && (
        <GameDetailPanel
          game={selectedGame}
          onClose={() => setSelectedGame(null)}
          onUpdated={handleGameUpdated}
          onDeleted={handleGameDeleted}
          onShowToast={showToast}
        />
      )}
    </div>
  );
}
