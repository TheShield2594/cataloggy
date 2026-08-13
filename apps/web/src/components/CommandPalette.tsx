import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { BarChart3, CalendarDays, Clapperboard, Film, Gamepad2, List, Search, Settings, Tv } from "lucide-react";
import { api, SearchResult } from "../api";
import { Poster } from "./Poster";
import { DetailPanel, useDetailPanel } from "./MediaDetailPanel";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useExitAnimation } from "../hooks/useExitAnimation";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useToast } from "../hooks/useToast";
import { useVisualViewport } from "../hooks/useVisualViewport";
import { MICRO_LABEL } from "./typography";

type Action = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ElementType;
  run: () => void;
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The debounce cancels the timer, which does nothing for a request already on
  // its way. `SearchPage` and `ListsPage` both pair the abort with a request id,
  // and this needs the same two: the abort stops the wasted round trip, and the
  // id decides which answer is allowed to reach the screen — a request already
  // resolved when the next keystroke lands can't be aborted, only ignored.
  const abortRef = useRef<AbortController>(undefined);
  const requestIdRef = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  const activeRowRef = useRef<HTMLButtonElement>(null);
  const { showToast } = useToast();
  const viewportStyle = useVisualViewport(open);
  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading, detail: panelDetail, detailLoading: panelDetailLoading } = useDetailPanel();
  const { exiting, requestClose, onExitAnimationEnd, reset } = useExitAnimation(onClose);

  // A DetailPanel opened from a result is drawn over a scrim this palette
  // already faded in, and hands it back on close. Holding the scrim still
  // across both swaps (staticScrim on the panel; no re-fade here on return)
  // keeps the backdrop reading as one surface. State rather than a render-time
  // ref read, so the class can't flip mid-session and replay the fade.
  const [scrimHandedBack, setScrimHandedBack] = useState(false);

  // Bottom of the stack relative to any DetailPanel opened from a result, so
  // Escape closes the panel back to the palette rather than both at once.
  useEscapeKey(requestClose, open);

  // Arrowing past the fold of the results scroller would otherwise move
  // the highlight somewhere the user can't see. "nearest" makes this a no-op
  // when the row is already visible, so mouse hover doesn't yank the list.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      // The palette stays mounted across open/close cycles, so a fresh open
      // has to clear the previous close's exit state — and a fresh open means
      // a fresh scrim, which should fade in again.
      reset();
      setScrimHandedBack(false);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open, reset]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      setSearchError(false);
      return;
    }
    setSearching(true);
    setSearchError(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = ++requestIdRef.current;
      void (async () => {
        try {
          const [movies, series] = await Promise.all([
            api.search("movie", query, controller.signal),
            api.search("series", query, controller.signal),
          ]);
          if (requestIdRef.current !== requestId) return;
          const merged: SearchResult[] = [];
          const maxLen = Math.max(movies.length, series.length);
          for (let i = 0; i < maxLen && merged.length < 8; i++) {
            if (i < movies.length) merged.push(movies[i]);
            if (i < series.length) merged.push(series[i]);
          }
          setResults(merged.slice(0, 8));
        } catch (err) {
          if (requestIdRef.current !== requestId) return;
          // An abort is this component cancelling its own request; the palette
          // is mid-search, not broken, so it must not say search is unavailable.
          if (err instanceof DOMException && err.name === "AbortError") return;
          setResults([]);
          setSearchError(true);
        } finally {
          // Clearing the spinner is a staleness decision like the rest: the
          // superseded request finishing says nothing about the live one.
          if (requestIdRef.current === requestId) setSearching(false);
        }
      })();
    }, 250);
    // Every way this effect can be superseded ends here, which is why the abort
    // lives in the cleanup rather than beside the request. Clearing the timer
    // alone only covers a query replaced *during* the debounce; emptying the
    // input takes the early return above and never schedules the timer that
    // would have cancelled the request already in flight, so the results for a
    // query no longer in the box arrived and rendered under an empty one.
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      requestIdRef.current++;
    };
  }, [query]);

  // The palette stays mounted across open/close cycles by design (App.tsx), so
  // a search left running when it closes would otherwise keep going and land in
  // state nobody is looking at. Closing is where it gets dropped; the effect
  // above owns the abort while the palette is open.
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = undefined;
    requestIdRef.current++;
  }, [open]);

  const goToSearch = useCallback((q: string) => {
    // Navigate immediately; the palette animates out over the new page.
    requestClose();
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }, [navigate, requestClose]);

  const openDetail = useCallback((r: SearchResult) => {
    setSelectedItem(r);
  }, [setSelectedItem]);

  const actions: Action[] = [
    { id: "nav-dashboard", label: "Go to Dashboard", icon: Clapperboard, run: () => { requestClose(); navigate("/"); } },
    { id: "nav-search", label: "Go to Search", icon: Search, run: () => { requestClose(); navigate("/search"); } },
    { id: "nav-lists", label: "Go to Lists", icon: List, run: () => { requestClose(); navigate("/lists"); } },
    { id: "nav-games", label: "Go to Games", icon: Gamepad2, run: () => { requestClose(); navigate("/games"); } },
    { id: "nav-calendar", label: "Go to Calendar", icon: CalendarDays, run: () => { requestClose(); navigate("/calendar"); } },
    { id: "nav-stats", label: "Go to Stats", icon: BarChart3, run: () => { requestClose(); navigate("/stats"); } },
    { id: "nav-settings", label: "Go to Settings", icon: Settings, run: () => { requestClose(); navigate("/settings"); } },
  ];

  const visibleActions = query.trim()
    ? actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
    : actions;

  /*
   * The titles actually on screen, which is not the same as `results`: a newer
   * search leaves the previous results in state while it is in flight, and the
   * title group is not rendered during one. Everything that indexes rows —
   * the option ids, the count the arrow keys clamp to, what Enter opens — has
   * to agree with what was rendered, or `aria-activedescendant` names an
   * element that isn't in the document.
   */
  const shownResults = searching ? [] : results;
  const totalItems = shownResults.length + visibleActions.length;

  /*
   * The palette is a combobox over a list, and it was none of that in the
   * markup: an <input> beside a stack of <button>s, with the highlighted row
   * marked by a background colour and nothing else. Arrow keys moved
   * `activeIndex`, which changed what Enter would do — with no way for a screen
   * reader to know either the highlight had moved or what it had moved to.
   *
   * Focus stays in the input (typing has to keep working), so the highlight is
   * published with `aria-activedescendant` pointing at the active option's id
   * rather than by moving focus. That is also why every option carries
   * `tabIndex={-1}`: they are still <button>s so a pointer user can click them,
   * but a listbox's options must not be tab stops of their own.
   */
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const hasList = totalItems > 0;
  // `activeIndex` is only clamped when an arrow key moves it, so a list that
  // shrinks underneath it can leave it past the end until the next keypress.
  const activeOptionId = hasList && activeIndex < totalItems ? optionId(activeIndex) : undefined;

  // Empty until a query has been typed — an announcement on open would be
  // "10 commands" before the user has asked anything.
  const listStatus = !query.trim()
    ? ""
    : searching
      ? "Searching…"
      : searchError
        ? "Search is unavailable."
        : totalItems === 0
          ? `Nothing matches “${query.trim()}”.`
          : `${totalItems} suggestion${totalItems === 1 ? "" : "s"}.`;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex < shownResults.length) {
        const r = shownResults[activeIndex];
        if (r) openDetail(r);
      } else {
        const action = visibleActions[activeIndex - shownResults.length];
        if (action) action.run();
        else if (query.trim()) goToSearch(query);
      }
    }
  };

  if (!open && !selectedItem) return null;

  if (selectedItem) {
    return (
      <DetailPanel
        item={selectedItem}
        history={panelHistory}
        historyLoading={panelHistoryLoading}
        detail={panelDetail}
        detailLoading={panelDetailLoading}
        // The panel opens over the scrim this palette already faded in.
        staticScrim
        // Drops back to the palette rather than dismissing both layers — the
        // palette keeps its query and results, so the next title is one click away.
        onClose={() => {
          setScrimHandedBack(true);
          setSelectedItem(null);
        }}
        onShowToast={showToast}
        onHistoryChange={(events) => setPanelHistory(events)}
        onSelectItem={setSelectedItem}
      />
    );
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:pt-[12vh]"
      style={viewportStyle}
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Fades on a fresh open, holds still when a closing DetailPanel hands
          the (identical) scrim back — but always fades out with the palette. */}
      <div className={`overlay-scrim absolute inset-0 ${scrimHandedBack && !exiting ? "" : "overlay-fade"} ${exiting ? "overlay-exit" : ""}`} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`glass-surface overlay-dialog relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl shadow-e3 ${exiting ? "overlay-exit" : ""}`}
        style={{ background: "var(--bg-0)", border: "1px solid var(--border-strong)" }}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onExitAnimationEnd}
      >
        <div className="flex flex-none items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
          <Search className="h-4 w-4 flex-none" style={{ color: "var(--text-mute)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search everything..."
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "var(--text)" }}
            aria-label="Search everything"
            role="combobox"
            aria-expanded={hasList}
            aria-controls={hasList ? listId : undefined}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
          />
          <kbd
            className="rounded px-1.5 py-0.5 text-2xs font-medium"
            style={{ background: "var(--surface-strong)", color: "var(--text-mute)" }}
          >
            Esc
          </kbd>
        </div>

        {/* Stays mounted across every state below, which come and go as whole
            subtrees — a live region that unmounts announces nothing. */}
        <p className="sr-only" role="status" aria-live="polite" aria-label="Palette results">
          {listStatus}
        </p>

        <div className="min-h-0 flex-auto overflow-y-auto py-2 sm:max-h-[60vh]">
          {searching && (
            <p className="px-4 py-3 text-xs" style={{ color: "var(--text-dim)" }}>Searching...</p>
          )}

          {!searching && searchError && (
            <p className="px-4 py-3 text-xs" style={{ color: "var(--text-dim)" }}>
              Search is unavailable right now. Check your TMDB configuration in Settings.
            </p>
          )}

          {!searching && !searchError && query.trim() && results.length === 0 && visibleActions.length === 0 && (
            <p className="px-4 py-3 text-xs" style={{ color: "var(--text-dim)" }}>No results for "{query}".</p>
          )}

          <div id={listId} role="listbox" aria-label="Suggestions">
            {shownResults.length > 0 && (
              <div className="px-2 pb-2" role="group" aria-label="Titles">
                <p aria-hidden="true" className={`px-2 pb-1 ${MICRO_LABEL}`} style={{ color: "var(--text-mute)" }}>
                  Titles
                </p>
                {shownResults.map((r, i) => (
                  <button
                    key={r.imdbId}
                    id={optionId(i)}
                    ref={activeIndex === i ? activeRowRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === i}
                    tabIndex={-1}
                    onClick={() => openDetail(r)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors"
                    style={{ background: activeIndex === i ? "var(--surface-strong)" : "transparent" }}
                  >
                    <div aria-hidden="true" className="h-9 w-7 flex-none overflow-hidden rounded" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
                      <Poster src={r.poster ?? undefined} alt="" className="h-full w-full" sizes="28px" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>{r.name}</p>
                      {/* The type is a bare icon on screen, so the option's name
                          would otherwise end at the year. */}
                      <p className="text-2xs" style={{ color: "var(--text-mute)" }}>
                        {r.year ?? ""}{" "}
                        {r.type === "movie"
                          ? <Film aria-hidden="true" className="inline h-3 w-3" />
                          : <Tv aria-hidden="true" className="inline h-3 w-3" />}
                        <span className="sr-only">{r.type === "movie" ? "Movie" : "Series"}</span>
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="px-2" role="group" aria-label="Navigate">
              {visibleActions.length > 0 && (
                <p aria-hidden="true" className={`px-2 pb-1 pt-1 ${MICRO_LABEL}`} style={{ color: "var(--text-mute)" }}>
                  Navigate
                </p>
              )}
              {visibleActions.map((action, i) => {
                const idx = shownResults.length + i;
                return (
                  <button
                    key={action.id}
                    id={optionId(idx)}
                    ref={activeIndex === idx ? activeRowRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === idx}
                    tabIndex={-1}
                    onClick={action.run}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors"
                    style={{ background: activeIndex === idx ? "var(--surface-strong)" : "transparent" }}
                  >
                    <action.icon aria-hidden="true" className="h-4 w-4 flex-none" style={{ color: "var(--text-dim)" }} />
                    <span className="text-sm" style={{ color: "var(--text)" }}>{action.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
