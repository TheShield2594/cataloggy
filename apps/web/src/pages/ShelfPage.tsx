import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Play, RotateCw } from "lucide-react";
import {
  api,
  type CheckIn,
  type Game,
  type ListItemWithMeta,
  type SeriesProgress,
  type WatchEvent,
} from "../api";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { GameDetailPanel } from "../components/GameDetailPanel";
import { GhostLoader } from "../components/GhostLoader";
import { Poster } from "../components/Poster";
import { ProgressRuler } from "../components/ProgressRuler";
import { SegmentedControl, type SegmentedOption } from "../components/SegmentedControl";
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
import { PosterGrid } from "../components/PosterGrid";
import { PosterCard } from "../components/PosterCard";

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
 * Steam sync, /history is the full log. They are reachable from the rail's
 * "Manage" group, and from the tab bar's "More" sheet.
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

/**
 * The kind filter, as options for the segmented control.
 *
 * The counts moved out of the labels and into the accessible names. They were
 * carried as a second number inside each button — "Shows 12" — which is a
 * useful fact and the wrong place for it: a segmented control is a row of peers
 * whose widths are fixed and equal, and four labels each carrying a variable
 * number is how that row starts wrapping on a 320px phone. The page already
 * writes the totals out under its title, and the Library header repeats the
 * count for whatever filter is on.
 *
 * The fact itself is not lost. It stays in the announced name — "Shows, 12
 * titles" — which is where it was doing the most work anyway: it is the reason
 * an empty kind can be disabled rather than hidden, and a disabled control with
 * no explanation is the thing that reads as a fault.
 */
function kindOptions(counts: Record<ShelfFilter, number>): SegmentedOption<ShelfFilter>[] {
  return SHELF_FILTERS.map((filter) => {
    const count = counts[filter.value];
    return {
      value: filter.value,
      label: filter.label,
      // The visible label leads, which is what SC 2.5.3 asks of a name longer
      // than its text.
      ariaLabel: `${filter.label}, ${count} ${count === 1 ? "title" : "titles"}`,
      // A kind with nothing in it is still shown, but disabled — hiding it
      // would make the row change length as a library grows, and a viewer who
      // has learned where "Games" sits would find "Films" there instead.
      disabled: count === 0,
    };
  });
}

/* ─── Up Next ──────────────────────────────────────────────── */

/**
 * A card for something you are part-way through: the art, what comes next, the
 * unit it is measured in, and one action.
 *
 * This was a list of rows in a bordered panel, on the argument that what you
 * are half-way through is a small set you want to *read* rather than browse.
 * The argument still holds and this is still a small set — but a 46px thumbnail
 * is not the artwork, it is a stamp of it, and the row spent its width on a
 * caption while the thing that identifies a show sat in a strip beside it.
 *
 * A 16:9 card is what the platform gives the same content: the still is the
 * subject, the caption is over it, and the episode ruler runs along the bottom
 * where a scrubber would. The unit the row was protecting is all still here —
 * ticks for a season, a caption for hours, nothing for a film.
 *
 * Two buttons rather than one: the card body opens the title, and the trailing
 * circle marks the next unit. They cannot be nested, so the body's hit area is
 * an absolutely positioned button under the caption and the caption is
 * `pointer-events-none` above it, with the action button opting back in. Both
 * are named, and the caption's text is not a control.
 */
function UpNextCard({
  entry,
  eager,
  onOpen,
  onResume,
  resumeLabel,
  resumeBusy,
}: {
  entry: ShelfEntry;
  /**
   * Whether this card's still is above the fold. Only the first few are: past
   * that they are off the end of the rail or below the grid, and `eager` asks
   * the browser for `fetchPriority: high` on artwork nobody is looking at,
   * against the artwork they are.
   */
  eager: boolean;
  onOpen: () => void;
  onResume?: (() => void) | undefined;
  resumeLabel?: string | undefined;
  resumeBusy?: boolean | undefined;
}) {
  // The landscape still if the record carries one, the poster if not. A poster
  // in a 16:9 frame is cropped to its middle, which is a worse picture than the
  // still and a much better one than a grey box.
  const art = entry.item?.background ?? entry.art ?? undefined;

  return (
    <div
      className="relative isolate w-[19rem] flex-none snap-start overflow-hidden rounded-2xl sm:w-auto"
      style={{ aspectRatio: "16 / 9", background: "var(--surface)" }}
    >
      <Poster
        src={art}
        alt=""
        className="absolute inset-0 h-full w-full"
        eager={eager}
        sizes="(min-width: 640px) 420px, 304px"
      />
      {/* The scrim starts at 35% rather than at the top: a caption needs a
          floor under it, and darkening the whole frame to get one takes the
          picture down with it. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.78) 100%)" }}
      />
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open details for ${entry.title}`}
        className="absolute inset-0 h-full w-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
      />
      <div className="pointer-events-none absolute inset-x-3.5 bottom-3.5 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate" style={{ color: "rgba(255,255,255,0.72)" }}>
            {entry.meta}
          </p>
          <p className="mt-0.5 truncate text-[1.125rem] font-bold text-white">{entry.title}</p>
          {entry.ruler ? (
            <ProgressRuler
              value={entry.ruler.value}
              total={entry.ruler.total}
              partial={entry.ruler.partial}
              discrete={entry.ruler.discrete}
              // Nothing on the card writes the count out in words — the ticks
              // are the count — so this is the only thing that can say "4 of 10
              // episodes watched" to someone who can't see them.
              label={entry.ruler.label}
              // Short of the full card width: a ruler that runs edge to edge
              // reads as a scrubber for the card rather than as a count of
              // episodes, and it would run under the action button.
              className="mt-2.5 max-w-[12.5rem]"
            />
          ) : (
            entry.trailing && (
              <p className="meta mt-1 truncate" style={{ color: "rgba(255,255,255,0.72)" }}>
                {entry.trailing}
              </p>
            )
          )}
        </div>
        {onResume && (
          <button
            type="button"
            onClick={onResume}
            disabled={resumeBusy}
            aria-label={resumeLabel}
            title={resumeLabel}
            className="pointer-events-auto flex h-11 w-11 flex-none items-center justify-center rounded-full transition-transform duration-fast active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            // White rather than the accent: it sits on artwork of unknown
            // colour, where the accent is one hue among however many the still
            // happens to contain, and white is the only fill that is legible
            // over all of them.
            style={{ background: "rgba(255,255,255,0.92)", color: "#000" }}
          >
            {resumeBusy ? (
              <RotateCw className="h-4 w-4 animate-spin" />
            ) : (
              // Nudged right by a pixel: a triangle's optical centre sits left
              // of its bounding box, so a centred play glyph reads as
              // off-centre.
              <Play className="h-4 w-4 translate-x-[1px] fill-current" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── A cell in the grid ───────────────────────────────────── */

/**
 * One cell of the grid: artwork, title, and the run that says what it is.
 *
 * Deliberately the same cell for all three kinds — the run underneath is where
 * they differ, and it is doing the work the type badges used to do badly.
 */
function ShelfCell({ entry, eager, onOpen }: { entry: ShelfEntry; eager: boolean; onOpen: () => void }) {
  return (
    <PosterCard
      poster={entry.art}
      name={entry.title}
      onOpen={onOpen}
      openLabel={`Open details for ${entry.title}`}
      eager={eager}
    >
      {/*
       * No type badge on the artwork. The coloured "MOVIE"/"SERIES" pills the
       * grids used to carry were the tell the redesign is aimed at: a label
       * shouted over the picture, in a colour that means nothing, saying what
       * the line below already says quietly. The kind is the first token of the
       * caption instead, where the year and the runtime already live.
       */}
      <p className="mt-2 truncate text-[0.8125rem] font-semibold" style={{ color: "var(--text)" }}>
        {entry.title}
      </p>
      <p className="meta truncate" style={{ color: "var(--text-mute)" }}>
        {entry.meta}
      </p>
    </PosterCard>
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

  /*
   * Everything the page can render, which is not the same as `shelf`.
   *
   * The grid is built from lists and the game library; the in-progress block is
   * built from the series-progress feed, and a show you watch through a Plex
   * webhook without ever adding it to a list appears only in the second. Counting
   * `shelf` alone therefore undercounts the page — and worse, a library whose
   * only series is one of those left the "Shows" filter reading 0 and *disabled*
   * while shows were visible on screen above it.
   *
   * In-progress wins a key collision: its entry carries the ruler and the
   * episode the list row knows nothing about.
   */
  const everything = useMemo(() => {
    const byKey = new Map(shelf.map((entry) => [entry.key, entry]));
    for (const entry of inProgress) byKey.set(entry.key, entry);
    return [...byKey.values()];
  }, [shelf, inProgress]);

  const counts = useMemo(() => countByKind(everything), [everything]);

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
    everything,
    lastEvent ? `Last watched ${timeAgo(lastEvent.watchedAt)}` : null
  );

  const nothingAtAll = !loading && everything.length === 0;

  return (
    <div>
      <header className="mb-4 min-w-0">
        <h1 className={PAGE_TITLE} style={{ color: "var(--text)" }}>
          Shelf
        </h1>
        {/* 15px, not the 12px caption rank: this is the large title's own
            subtitle, and the only line on the screen that describes the whole
            of what is under it. */}
        <p className="mt-0.5 truncate text-[0.9375rem] tabular-nums" style={{ color: "var(--text-dim)" }}>
          {summary}
        </p>
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

      {!nothingAtAll && (
        <SegmentedControl
          label="Filter the shelf by kind"
          options={kindOptions(counts)}
          value={filter}
          onChange={(next) =>
            setSearchParams(
              (prev) => {
                const params = new URLSearchParams(prev);
                if (next === "all") params.delete("kind");
                else params.set("kind", next);
                return params;
              },
              // Replace rather than push: flicking along the filter row is one
              // act of looking, and Back should leave the Shelf rather than
              // walk back through four filters to get there.
              { replace: true }
            )
          }
          className="sm:max-w-md"
        />
      )}

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
        <div className="mt-6 flex flex-col gap-7">
          {visibleInProgress.length > 0 && (
            <section aria-labelledby="shelf-up-next">
              <h2 id="shelf-up-next" className={`${SECTION_TITLE} mb-3`} style={{ color: "var(--text)" }}>
                Up Next
              </h2>
              {/*
               * A snapping rail below `sm`, a grid above it.
               *
               * The same cards either way — what changes is whether they are
               * laid out or scrolled. A phone has room for one and a bit, which
               * is what makes a rail readable (the half-card is the affordance);
               * a desktop has room for three across, where a rail would be a
               * horizontal scrollbar in the middle of a page that scrolls
               * vertically.
               *
               * The negative margin lets the rail bleed to the edges of the
               * screen while its first card still lines up with the column, so
               * the last card doesn't stop short of the edge with a gutter's
               * worth of black beside it.
               */}
              <div className="scrollbar-hide -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-3">
                {visibleInProgress.map((entry, index) => {
                  const series =
                    entry.kind === "show" ? progress.find((s) => `series:${s.imdbId}` === entry.key) : undefined;
                  return (
                    <UpNextCard
                      key={entry.key}
                      entry={entry}
                      // Three: what a desktop shows across, and one and a bit
                      // more than a phone's rail has room for. The rest load
                      // lazily as they are scrolled to, the same way the grid
                      // below does.
                      eager={index < 3}
                      onOpen={() => openEntry(entry)}
                      onResume={series ? () => void markNext(series) : undefined}
                      resumeLabel={
                        series
                          ? `Mark S${series.nextSeason}:E${series.nextEpisode} of ${entry.title} watched`
                          : undefined
                      }
                      resumeBusy={markingId !== null && `series:${markingId}` === entry.key}
                    />
                  );
                })}
              </div>
            </section>
          )}

          <section aria-labelledby="shelf-rest">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h2 id="shelf-rest" className={SECTION_TITLE} style={{ color: "var(--text)" }}>
                Library
              </h2>
              <span className="meta flex-none" style={{ color: "var(--text-dim)" }}>
                {rest.length} · Recently added
              </span>
            </div>

            {rest.length === 0 ? (
              <p className="py-10 text-center text-sm" style={{ color: "var(--text-mute)" }}>
                Nothing else under this filter.
              </p>
            ) : (
              /* Three across on a phone rather than two. A poster is
                 recognisable well below the width two-up gives it, and three is
                 what turns the grid into a *library* — you see a shelf of them
                 at once instead of a stack you scroll through a pair at a
                 time. */
              <PosterGrid density="library">
                {visibleRest.map((entry, index) => (
                  <ShelfCell key={entry.key} entry={entry} eager={index < 6} onOpen={() => openEntry(entry)} />
                ))}
              </PosterGrid>
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
