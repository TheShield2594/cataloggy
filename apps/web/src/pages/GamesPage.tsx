import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Check, Clock, Gamepad2, Plus, RefreshCw, Star } from "lucide-react";
import { api, ApiError, type Game, type GameSearchResult, type GameSort, type SteamStatus } from "../api";
import { GameDetailPanel } from "../components/GameDetailPanel";
import { useDebouncedSearch } from "../hooks/useDebouncedSearch";
import { useToast } from "../hooks/useToast";
import { SearchAddDialog, SearchAddResultRow } from "../components/SearchAddDialog";
import { preconnectToGameArtwork } from "../utils/preconnect";
import { useCachedState } from "../hooks/useCachedState";
import { formatPlaytime } from "../utils/playtime";
import { formatRating, ratingLabel, RATING_MAX } from "../utils/rating";
import { PAGE_TITLE } from "../components/typography";
import { PosterGrid } from "../components/PosterGrid";
import { PosterCard } from "../components/PosterCard";

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

/* ─── "Games isn't set up" notice ──────────────────────────── */

/**
 * The state for an instance that was never given credentials for Games.
 *
 * This is a different statement from "you have no games", and the page showed
 * the second for both until now. It could not do better: `GET /games` is a
 * plain database read, so an empty library looks identical either way, and the
 * one route that knows — search — is behind the add dialog. `/games/igdb/status`
 * and `/games/steam/status` are what make the distinction available up front.
 *
 * Two integrations doing two jobs, so the copy names both rather than telling
 * someone to "configure Games": adding a game is an IGDB search, and the
 * automatic library and playtime sync is Steam's. Either alone is useful.
 */
function ConnectGamesNotice({ compact = false }: { compact?: boolean }) {
  const body = (
    <>
      Adding a game is an IGDB search, and automatic library and playtime sync comes from Steam.
      Setting up either one is enough to get started.
    </>
  );

  if (compact) {
    return (
      <div className="rounded-xl border px-3 py-3 text-xs" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <p className="font-semibold" style={{ color: "var(--text)" }}>Game search isn&rsquo;t set up yet</p>
        <p className="mt-1" style={{ color: "var(--text-dim)" }}>{body}</p>
        <Link to="/settings?tab=integrations" className="mt-1.5 inline-block py-1 font-medium text-claw-text underline-offset-2 transition-colors hover:underline">
          Open Settings &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <Gamepad2 className="h-12 w-12" style={{ color: "var(--text-mute)" }} />
      <p style={{ color: "var(--text-dim)" }}>Games isn&rsquo;t set up yet.</p>
      <p className="max-w-sm text-sm" style={{ color: "var(--text-mute)" }}>{body}</p>
      <Link to="/settings?tab=integrations" className="btn-secondary btn-sm mt-1">
        Connect IGDB or Steam
      </Link>
    </div>
  );
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
  const [adding, setAdding] = useState<Record<number, boolean>>({});
  // Held apart from the search's own error because it isn't one: searching an
  // instance without IGDB credentials is a setup step outstanding, not a
  // failure, and it reads as a notice with a way forward rather than as red
  // text.
  const [notConfigured, setNotConfigured] = useState(false);

  const search = useCallback((q: string, signal: AbortSignal) => api.searchGames(q, signal), []);

  const { results, setResults, searching, error, setError } = useDebouncedSearch<GameSearchResult>(
    query,
    search,
    {
      onStart: useCallback(() => setNotConfigured(false), []),
      // Branch on the code, not the message: the prose is the API's to reword.
      onError: useCallback((err: unknown) => {
        if (err instanceof ApiError && err.code === "igdb_not_configured") {
          setNotConfigured(true);
          return "handled" as const;
        }
      }, []),
    }
  );

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
    <SearchAddDialog
      title="Add a game"
      titleId="add-game-modal-title"
      query={query}
      onQueryChange={setQuery}
      placeholder="Search games on IGDB..."
      inputLabel="Search games"
      onClose={onClose}
    >
      {error && <p role="alert" className="mb-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-danger">{error}</p>}
      {notConfigured && <div className="mb-2"><ConnectGamesNotice compact /></div>}
      {searching && <p className="py-6 text-center text-sm" style={{ color: "var(--text-mute)" }}>Searching...</p>}
      {!searching && query.trim() && results.length === 0 && !error && !notConfigured && (
        <p className="py-6 text-center text-sm" style={{ color: "var(--text-mute)" }}>No results found.</p>
      )}
      <div className="space-y-1">
        {results.map((r) => (
          <SearchAddResultRow
            key={r.igdbId}
            disabled={!!adding[r.igdbId] || r.inLibrary}
            muted={r.inLibrary}
            onAdd={() => void handleAdd(r)}
            thumbnail={
              r.coverUrl ? (
                <img src={r.coverUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center"><Gamepad2 className="h-4 w-4" style={{ color: "var(--text-mute)" }} /></div>
              )
            }
            title={r.title}
            subtitle={
              <>
                {r.releaseDate ? new Date(r.releaseDate).getFullYear() : "Unknown"}
                {r.genres.length > 0 ? ` \u00b7 ${r.genres.slice(0, 2).join(", ")}` : ""}
              </>
            }
            trailing={
              r.inLibrary ? (
                <Check className="h-4 w-4 flex-none text-success" />
              ) : (
                <Plus className="h-4 w-4 flex-none text-claw-text" />
              )
            }
          />
        ))}
      </div>
    </SearchAddDialog>
  );
}

/* ─── Game Card ────────────────────────────────────────────── */

function GameCard({ game, onSelect }: { game: Game; onSelect: (game: Game) => void }) {
  return (
    <PosterCard
      poster={game.coverUrl}
      name={game.title}
      onOpen={() => onSelect(game)}
      className="flex flex-col"
      overlay={
        /* Fixed green rather than --success-text, for the same reason
           .btn-danger's rose is fixed: this badge sits on cover art, not on a
           theme surface, so it has to carry its own contrast. The pale
           emerald-500 it used measured 2.30:1 against the white on top of it;
           this pairing is 6.8:1 and reads as the same green. */
        game.finished && (
          <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-md bg-[#00693e] px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-white shadow-e1">
            <Check aria-hidden="true" className="h-3 w-3" /> Finished
          </span>
        )
      }
    >
      <div className="mt-3">
        <p className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{game.title}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="meta-row flex items-center gap-1.5" style={{ color: "var(--text-mute)" }}>
            <Clock className="h-3 w-3" /> {formatPlaytime(game.playtimeMinutes)}
          </span>
          {game.rating != null && (
            <span className="meta flex items-center gap-0.5 text-warning" title={ratingLabel(game.rating)}>
              <Star className="h-3 w-3 fill-warning text-warning" />
              {formatRating(game.rating)}
              <span style={{ color: "var(--text-mute)" }}>/{RATING_MAX}</span>
            </span>
          )}
        </div>
      </div>
    </PosterCard>
  );
}

/* ─── Steam status bar ────────────────────────────────────── */

// Takes the status rather than fetching it: the page now needs the same answer
// for its empty state, and two components asking the same question is two
// requests that can disagree.
function SteamStatusBar({ status, onSynced }: { status: SteamStatus | null; onSynced: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const { showToast } = useToast();

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

  /*
   * Whether either integration is set up. `null` means the question hasn't been
   * answered yet — which is not the same as "no", and the empty state waits for
   * it rather than guessing. Telling somebody to go and connect IGDB because a
   * status request was slow would be worse than the bug this replaces.
   *
   * Each request is allowed to fail alone and a failure counts as "don't know",
   * following `useSettingsHealth`: a health answer nobody could fetch should
   * contribute nothing rather than a wrong claim.
   */
  const [igdbConfigured, setIgdbConfigured] = useState<boolean | null>(null);
  const [steamStatus, setSteamStatus] = useState<SteamStatus | null>(null);
  // Both requests have settled, however they settled. The empty state waits for
  // this rather than rendering on what it knows so far, because the two readings
  // of an empty library are different sentences and showing one then swapping it
  // for the other is the same wrong statement this fixes, just briefly.
  //
  // What makes that wait safe is the short deadline on the two reads
  // (`INTEGRATION_STATUS_TIMEOUT_MS`) rather than the library load, which can
  // finish first and leave this the only thing outstanding — with `request()`'s
  // 30s default that was a blank region for half a minute.
  const [integrationsKnown, setIntegrationsKnown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Dropped on unmount like every other request on this page: leaving is as
    // much a reason to abandon the answer as switching profile is.
    const controller = new AbortController();
    void (async () => {
      const [igdb, steam] = await Promise.all([
        api.getIgdbStatus(controller.signal).catch(() => null),
        api.getSteamStatus(controller.signal).catch(() => null),
      ]);
      if (cancelled) return;
      setIgdbConfigured(igdb ? igdb.configured : null);
      setSteamStatus(steam);
      setIntegrationsKnown(true);
    })();
    return () => { cancelled = true; controller.abort(); };
  }, []);

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
    () => games !== null && games.length === 0 && !loading && integrationsKnown,
    [games, loading, integrationsKnown]
  );

  // Both questions answered, both answers no. A request that failed leaves its
  // answer unknown and falls through to the library-empty state below — the
  // safer of the two to be wrong about, since it still offers Add rather than
  // sending someone to Settings for credentials they may already have.
  const nothingConfigured = useMemo(
    () => igdbConfigured === false && steamStatus !== null && !steamStatus.configured,
    [igdbConfigured, steamStatus]
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className={PAGE_TITLE} style={{ color: "var(--text)" }}>Games</h1>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="btn-primary btn-sm"
        >
          <Plus className="h-4 w-4" /> Add game
        </button>
      </div>

      <SteamStatusBar status={steamStatus} onSynced={() => void loadGames(sort)} />

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
            // Without this the active sort is a background colour and nothing
            // else — SC 1.4.1 and 4.1.2.
            aria-pressed={sort === opt.value}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset ${sort === opt.value ? "bg-claw-500 text-claw-on" : ""}`}
            style={sort === opt.value ? undefined : { color: "var(--text-mute)" }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-danger">{error}</p>
      )}

      {loading && (
        <PosterGrid>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="skeleton rounded-xl" style={{ aspectRatio: "var(--poster-ratio)" }} />
          ))}
        </PosterGrid>
      )}

      {emptyState && (nothingConfigured ? (
        <ConnectGamesNotice />
      ) : (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <Gamepad2 className="h-12 w-12" style={{ color: "var(--text-mute)" }} />
          <p style={{ color: "var(--text-dim)" }}>No games in your library yet.</p>
          <p className="max-w-sm text-sm" style={{ color: "var(--text-mute)" }}>
            Add one manually, or connect Steam to sync your library automatically.
          </p>
          {/* The text said "add one manually" and then offered nothing to do it
              with — the only Add control is at the top of the page, which is
              not where somebody reading this is looking. */}
          <button type="button" onClick={() => setShowAddModal(true)} className="btn-primary btn-sm mt-1">
            <Plus className="h-4 w-4" /> Add game
          </button>
        </div>
      ))}

      {!loading && games && games.length > 0 && (
        <PosterGrid>
          {games.map((game) => (
            <GameCard key={game.id} game={game} onSelect={setSelectedGame} />
          ))}
        </PosterGrid>
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
