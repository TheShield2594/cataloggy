import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Play, RotateCw } from "lucide-react";
import {
  api,
  CheckIn,
  Game,
  ListItemWithMeta,
  SeriesProgress,
  WatchEvent,
} from "../api";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { GameDetailPanel } from "../components/GameDetailPanel";
import { GhostLoader } from "../components/GhostLoader";
import { Poster, POSTER_GRID_SIZES } from "../components/Poster";
import { ProgressRuler } from "../components/ProgressRuler";
import { PAGE_TITLE, SECTION_TITLE } from "../components/typography";
import { useCachedState } from "../hooks/useCachedState";
import { useToast } from "../hooks/useToast";
import { timeAgo } from "../utils/timeAgo";
import {
  applyShelfFilter,
  buildShelf,
  countByKind,
  isGameInProgress,
  shelfEntryFromGameInProgress,
  shelfEntryFromSeriesProgress,
  shelfSummary,
  SHELF_FILTERS,
  type ShelfEntry,
  type ShelfFilter,
} from "./shelf";

/*
 * The Shelf.
 *
 * Lists, Games and History were three destinations for one idea, separated by
 * the table each thing happened to be stored in. This page is that idea with
 * the tabs removed: everything you track, in one grid, behind one filter, with
 * whatever you are part-way through pinned above it.
 *
 * The unification is only worth doing if it costs no precision, so nothing here
 * flattens a show and a game into a shared percentage — see `shelf.ts`, where
 * each kind's units are chosen, and `ProgressRuler`, which draws episodes as
 * ticks and continuous quantities as a bar. A grid of forty tells you what is
 * part-watched, and in what unit, with no badge and no hover.
 *
 * The pages this replaces as a *browsing* surface still exist as the places you
 * manage things: /lists creates and edits lists, /games adds a game and runs a
 * Steam sync, /history is the full log. They are reachable from the header
 * here, and from the rail.
 */

// Same reasoning as the Lists page's constant of the same name: an imported
// Letterboxd collection can carry thousands of rows, and the cost is the DOM
// nodes rather than the fetch. Grow the rendered slice on scroll instead of
// paginating a list that is already sorted and filtered in memory.
const RENDER_PAGE_SIZE = 60;

/**
 * Shared with the Games page's `games:recent` and the dashboard's
 * `dash:progress`. Two surfaces asking the same question should not each pay
 * for it, and arriving on either from the other then paints in the first frame.
 */
const GAMES_CACHE_KEY = "games:recent";
const PROGRESS_CACHE_KEY = "dash:progress";
/** The Shelf's own union. The per-list rows behind it stay under the Lists page's key. */
const SHELF_ITEMS_CACHE_KEY = "shelf:items";

/* ─── The filter row ───────────────────────────────────────── */

function KindFilter({
  active,
  counts,
  onChange,
}: {
  active: ShelfFilter;
  counts: Record<ShelfFilter, number>;
  onChange: (filter: ShelfFilter) => void;
}) {
  return (
    // A tab list rather than a row of buttons: these swap what the grid below
    // shows without navigating, which is what `tablist` describes and what lets
    // a screen reader announce "2 of 4" as the user moves along it.
    <div role="tablist" aria-label="Filter the shelf by kind" className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {SHELF_FILTERS.map((filter) => {
        const selected = active === filter.value;
        // A kind with nothing in it is still shown, but disabled — hiding it
        // would make the row change length as a library grows, and a viewer who
        // has learned where "Games" sits would find "Films" there instead.
        const empty = counts[filter.value] === 0;
        return (
          <button
            key={filter.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={empty && !selected}
            onClick={() => onChange(filter.value)}
            className={`tap-target flex flex-none items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset disabled:opacity-40 ${
              selected ? "bg-claw-500 text-claw-on" : "hover:bg-[var(--surface-strong)]"
            }`}
            style={
              selected
                ? undefined
                : { color: "var(--text-dim)", background: "var(--surface)", border: "1px solid var(--border)" }
            }
          >
            {filter.label}
            <span className="meta" style={{ opacity: 0.75 }}>
              {counts[filter.value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ─── In progress ──────────────────────────────────────────── */

/**
 * A row in the in-progress card: art, title, its own unit, and one action.
 *
 * Deliberately a list of rows rather than the carousel of poster cards this
 * replaces. What you are half-way through is a small set that you want to read
 * rather than browse — and a row has space for the unit, which a 12rem poster
 * caption does not.
 */
function InProgressRow({
  entry,
  onOpen,
  onResume,
  resumeLabel,
  resumeBusy,
}: {
  entry: ShelfEntry;
  onOpen: () => void;
  onResume?: () => void;
  resumeLabel?: string;
  resumeBusy?: boolean;
}) {
  return (
    <div role="group" aria-label={entry.title} className="flex items-center gap-3.5 px-4 py-3 sm:gap-4 sm:px-5">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open details for ${entry.title}`}
        className="flex min-w-0 flex-1 items-center gap-3.5 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset sm:gap-4"
      >
        <Poster
          src={entry.art ?? undefined}
          alt={entry.title}
          className="h-[4.3rem] w-[2.9rem] flex-none overflow-hidden rounded-lg ring-1 ring-[var(--border)]"
          sizes="46px"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>
              {entry.title}
            </span>
            {entry.trailing && (
              <span className="meta-caps flex-none" style={{ color: "var(--text-dim)" }}>
                {entry.trailing}
              </span>
            )}
          </span>
          <span className="meta-caps block truncate" style={{ color: "var(--text-mute)" }}>
            {entry.meta}
          </span>
          {entry.ruler && (
            <ProgressRuler
              value={entry.ruler.value}
              total={entry.ruler.total}
              partial={entry.ruler.partial}
              discrete={entry.ruler.discrete}
              // The row already writes the count out beside the title, so the
              // ruler repeating it would announce the same fact twice in two
              // different wordings.
              decorative={!!entry.trailing}
              label={entry.ruler.label}
              // Capped rather than fluid. Across a 1400px row a ruler stops
              // reading as "eight episodes, three watched" and starts reading
              // as a progress bar for the page itself; at this width the ticks
              // stay countable at a glance, which is the whole point of them.
              className="mt-0.5 max-w-sm"
            />
          )}
        </span>
      </button>
      {onResume && (
        <button
          type="button"
          onClick={onResume}
          disabled={resumeBusy}
          aria-label={resumeLabel}
          title={resumeLabel}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-claw-500 text-claw-on transition-transform duration-fast active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset"
        >
          {resumeBusy ? (
            <RotateCw className="h-4 w-4 animate-spin" />
          ) : (
            // Nudged right by a pixel: a triangle's optical centre sits left of
            // its bounding box, so a centred play glyph reads as off-centre.
            <Play className="h-4 w-4 translate-x-[1px] fill-current" />
          )}
        </button>
      )}
    </div>
  );
}

/* ─── A cell in the grid ───────────────────────────────────── */

function ShelfCell({ entry, eager, onOpen }: { entry: ShelfEntry; eager: boolean; onOpen: () => void }) {
  return (
    <div className="group">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open details for ${entry.title}`}
        className="card-lift relative block w-full overflow-hidden rounded-xl text-left ring-1 ring-[var(--border)]"
        style={{ aspectRatio: "2/3", backgroundColor: "var(--surface)" }}
      >
        <Poster
          src={entry.art ?? undefined}
          alt={entry.title}
          className="h-full w-full"
          eager={eager}
          sizes={POSTER_GRID_SIZES}
        />
      </button>
      {/*
       * No type badge on the artwork. The coloured "MOVIE"/"SERIES" pills the
       * grids used to carry were the tell the redesign is aimed at: a label
       * shouted over the picture, in a colour that means nothing, saying what
       * the line below already says quietly. The kind is the first token of the
       * mono run instead, where the year and the runtime already live.
       */}
      <p className="mt-2.5 truncate text-sm font-semibold" style={{ color: "var(--text)" }}>
        {entry.title}
      </p>
      <p className="meta-caps truncate" style={{ color: "var(--text-mute)" }}>
        {entry.meta}
      </p>
    </div>
  );
}

/* ─── The page ─────────────────────────────────────────────── */

export function ShelfPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get("kind");
  const filter: ShelfFilter = SHELF_FILTERS.some((f) => f.value === filterParam)
    ? (filterParam as ShelfFilter)
    : "all";

  const [items, setItems, itemsMeta] = useCachedState<ListItemWithMeta[]>(SHELF_ITEMS_CACHE_KEY, []);
  const [games, setGames] = useCachedState<Game[]>(GAMES_CACHE_KEY, []);
  const [progress, setProgress] = useCachedState<SeriesProgress[]>(PROGRESS_CACHE_KEY, []);
  const [checkin, setCheckin] = useState<CheckIn | null>(null);
  const [lastEvent, setLastEvent] = useState<WatchEvent | null>(null);

  const [loading, setLoading] = useState(!itemsMeta.hadCachedValue);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [renderLimit, setRenderLimit] = useState(RENDER_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  const { showToast } = useToast();
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const {
    selectedItem,
    setSelectedItem,
    panelHistory,
    setPanelHistory,
    panelHistoryLoading,
    detail: panelDetail,
    detailLoading: panelDetailLoading,
  } = useDetailPanel();

  const load = useCallback(async () => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const signal = controller.signal;
    setError(null);

    try {
      // The five questions the page opens with, asked at once. Each one that
      // isn't the shelf itself is allowed to fail on its own: a broken check-in
      // should cost the row its "42 min left", not the whole grid.
      const [lists, gamesRes, progressRes, checkinRes, historyRes] = await Promise.all([
        api.getLists(signal),
        api.listGames("recent", signal).catch(() => [] as Game[]),
        api.getSeriesProgress(signal).catch(() => [] as SeriesProgress[]),
        api.getCheckin(signal).catch(() => ({ checkin: null })),
        api.getWatchHistory(1, 0, { signal }).catch(() => [] as WatchEvent[]),
      ]);

      // One request per list, in parallel. The alternative — a union endpoint —
      // would be the right answer if a list could be large *and* numerous, but
      // a profile has a handful of lists and each is one indexed query, so this
      // costs a few concurrent requests rather than a new API surface. A list
      // that fails contributes nothing rather than emptying the shelf.
      const itemPages = await Promise.all(
        lists.lists.map((list) =>
          api.getListItems(list.id, signal).then((res) => res.items).catch(() => [] as ListItemWithMeta[])
        )
      );

      if (loadAbortRef.current !== controller) return;
      setItems(itemPages.flat());
      setGames(gamesRes ?? []);
      setProgress(progressRes ?? []);
      setCheckin(checkinRes.checkin);
      setLastEvent(historyRes[0] ?? null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (loadAbortRef.current !== controller) return;
      setError(err instanceof Error ? err.message : "Failed to load your shelf");
    } finally {
      if (loadAbortRef.current === controller) setLoading(false);
    }
  }, [setItems, setGames, setProgress]);

  useEffect(() => {
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  /* ── In progress ── */

  const inProgress = useMemo(() => {
    const shows = progress.map((s) => shelfEntryFromSeriesProgress(s, checkin));
    const playing = games.filter(isGameInProgress).map((g) => shelfEntryFromGameInProgress(g, timeAgo));
    // Shows first, then games by how recently they were touched. A show in
    // flight is the thing most likely to be resumed tonight, and the series
    // progress feed is already ordered by recency at the API.
    playing.sort((a, b) => (b.game?.lastPlayedAt ?? "").localeCompare(a.game?.lastPlayedAt ?? ""));
    return [...shows, ...playing];
  }, [progress, games, checkin]);

  const visibleInProgress = useMemo(() => applyShelfFilter(inProgress, filter), [inProgress, filter]);

  /* ── Everything else ── */

  const shelf = useMemo(() => buildShelf(items, games), [items, games]);
  const counts = useMemo(() => countByKind(shelf), [shelf]);

  // What is already pinned at the top doesn't also belong in the grid — the
  // section is called "everything else" and has to mean it.
  const inProgressKeys = useMemo(() => new Set(inProgress.map((entry) => entry.key)), [inProgress]);
  const rest = useMemo(
    () => applyShelfFilter(shelf, filter).filter((entry) => !inProgressKeys.has(entry.key)),
    [shelf, filter, inProgressKeys]
  );

  useEffect(() => setRenderLimit(RENDER_PAGE_SIZE), [filter]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || renderLimit >= rest.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setRenderLimit((prev) => Math.min(prev + RENDER_PAGE_SIZE, rest.length));
        }
      },
      { rootMargin: "800px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [renderLimit, rest.length]);

  const visibleRest = rest.slice(0, renderLimit);

  /* ── Actions ── */

  const openEntry = (entry: ShelfEntry) => {
    if (entry.game) setSelectedGame(entry.game);
    else if (entry.item) setSelectedItem(entry.item);
  };

  const markNext = async (s: SeriesProgress) => {
    setMarkingId(s.imdbId);
    try {
      await api.markNextEpisodeWatched(s.imdbId);
      showToast(`Marked S${s.nextSeason}:E${s.nextEpisode} of ${s.name}`, "success");
      // The whole in-progress block moves when an episode lands — the show can
      // finish a season, change position, or leave the list entirely — so this
      // refetches rather than patching one row and hoping the rest still agree.
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to mark episode", "error");
    } finally {
      setMarkingId(null);
    }
  };

  const summary = shelfSummary(
    shelf,
    lastEvent ? `Last watched ${timeAgo(lastEvent.watchedAt)}` : null
  );

  const nothingAtAll = !loading && shelf.length === 0 && inProgress.length === 0;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className={PAGE_TITLE} style={{ color: "var(--text)" }}>
            Shelf
          </h1>
          <p className="meta-caps mt-1.5" style={{ color: "var(--text-mute)" }}>
            {summary}
          </p>
        </div>
        {/* The management surfaces the Shelf browses on behalf of. Not nav
            items in their own right any more — you come here to look at what
            you track, and go there to change how it is organised. */}
        {/* Hidden below `sm`, where these three are already one tap away in the
            tab bar's "More" sheet and a second row of the same words above the
            kind filter reads as two competing tab strips. */}
        <nav aria-label="Manage" className="hidden flex-none items-center gap-1 sm:flex">
          {[
            { to: "/lists", label: "Lists" },
            { to: "/games", label: "Games" },
            { to: "/history", label: "History" },
          ].map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset"
              style={{ color: "var(--text-dim)" }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-5 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm text-danger"
          style={{ background: "color-mix(in srgb, var(--status-bad) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--status-bad) 25%, transparent)" }}
        >
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="btn-secondary btn-sm">
            Retry
          </button>
        </div>
      )}

      {!nothingAtAll && <KindFilter active={filter} counts={counts} onChange={(next) => {
        setSearchParams(
          (prev) => {
            const params = new URLSearchParams(prev);
            if (next === "all") params.delete("kind");
            else params.set("kind", next);
            return params;
          },
          // Replace rather than push: flicking along the filter row is one act
          // of looking, and Back should leave the Shelf rather than walk back
          // through four filters to get there.
          { replace: true }
        );
      }} />}

      {loading && shelf.length === 0 && inProgress.length === 0 ? (
        <GhostLoader label="Loading your shelf…" className="items-center py-24" />
      ) : nothingAtAll ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className={SECTION_TITLE} style={{ color: "var(--text-dim)" }}>
            Nothing on the shelf yet
          </p>
          <p className="mt-1.5 max-w-sm text-sm" style={{ color: "var(--text-mute)" }}>
            Search for a show or a film to add it to a list, or connect a source in Settings and let
            your history fill this in on its own.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link to="/search" className="btn-primary btn-sm">
              Search
            </Link>
            <Link to="/settings" className="btn-secondary btn-sm">
              Connect a source
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-9">
          {visibleInProgress.length > 0 && (
            <section aria-labelledby="shelf-in-progress">
              <h2 id="shelf-in-progress" className="eyebrow mb-3">
                In progress
              </h2>
              {/*
               * Card rank: 2xl radius on elevation 1, which is what the app's
               * surface ranks give an in-flow panel. The rows inside are
               * separated by hairlines rather than being cards of their own —
               * one surface holding a list, not a list of surfaces.
               */}
              <div
                className="overflow-hidden rounded-2xl shadow-e1"
                style={{ background: "var(--bg-1)", border: "1px solid var(--border)" }}
              >
                {visibleInProgress.map((entry, index) => (
                  <div key={entry.key}>
                    {index > 0 && <div className="mx-4 h-px sm:mx-5" style={{ background: "var(--border)" }} />}
                    <InProgressRow
                      entry={entry}
                      onOpen={() => openEntry(entry)}
                      onResume={
                        entry.kind === "show"
                          ? () => {
                              const series = progress.find((s) => `series:${s.imdbId}` === entry.key);
                              if (series) void markNext(series);
                            }
                          : undefined
                      }
                      resumeLabel={
                        entry.kind === "show"
                          ? (() => {
                              const series = progress.find((s) => `series:${s.imdbId}` === entry.key);
                              return series
                                ? `Mark S${series.nextSeason}:E${series.nextEpisode} of ${entry.title} watched`
                                : undefined;
                            })()
                          : undefined
                      }
                      resumeBusy={markingId !== null && `series:${markingId}` === entry.key}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="shelf-rest">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h2 id="shelf-rest" className="eyebrow">
                {visibleInProgress.length > 0 ? "Everything else" : "Everything"}
              </h2>
              <span className="meta-caps" style={{ color: "var(--text-mute)" }}>
                {rest.length} · sorted by added
              </span>
            </div>

            {rest.length === 0 ? (
              <p className="py-10 text-center text-sm" style={{ color: "var(--text-mute)" }}>
                Nothing else under this filter.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {visibleRest.map((entry, index) => (
                  <ShelfCell key={entry.key} entry={entry} eager={index < 5} onOpen={() => openEntry(entry)} />
                ))}
              </div>
            )}
            {renderLimit < rest.length && <div ref={sentinelRef} className="h-4" />}
          </section>
        </div>
      )}

      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          history={panelHistory}
          historyLoading={panelHistoryLoading}
          detail={panelDetail}
          detailLoading={panelDetailLoading}
          onClose={() => setSelectedItem(null)}
          onShowToast={showToast}
          onHistoryChange={setPanelHistory}
          onSelectItem={setSelectedItem}
        />
      )}

      {selectedGame && (
        <GameDetailPanel
          game={selectedGame}
          onClose={() => setSelectedGame(null)}
          onUpdated={(updated) => {
            setGames((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
            setSelectedGame(updated);
          }}
          onDeleted={(id) => {
            setGames((prev) => prev.filter((g) => g.id !== id));
            setSelectedGame(null);
          }}
          onShowToast={showToast}
        />
      )}
    </div>
  );
}
