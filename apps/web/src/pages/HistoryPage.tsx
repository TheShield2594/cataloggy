import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { AlertCircle, Calendar, Film, NotebookPen, Trash2, Tv } from "lucide-react";
import { api, SearchResult, WatchEvent } from "../api";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { useToast } from "../hooks/useToast";
import { useCachedState } from "../hooks/useCachedState";
import { relogWatchEvent } from "../utils/watchEvents";
import { PAGE_TITLE, SECTION_TITLE, KICKER } from "../components/typography";

const PAGE_SIZE = 25;

type TypeFilter = "all" | "movie" | "episode";

function groupLabel(date: Date, now: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This Week";
  if (diffDays < 30) return "This Month";
  return date.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function toSearchResult(event: WatchEvent): SearchResult {
  const isEpisode = event.type === "episode";
  return {
    imdbId: isEpisode ? (event.seriesImdbId ?? event.imdbId) : event.imdbId,
    type: isEpisode ? "series" : "movie",
    name: event.name,
    year: null,
    poster: event.poster ?? null,
    description: null,
    genres: [],
    rating: null,
    inWatchlist: false,
    inCollection: false,
    lists: [],
  };
}

/**
 * What a row's controls call the thing they act on.
 *
 * The visible row says the title once and the episode number beside it, in two
 * separate elements; a label built from `event.name` alone would give three
 * buttons in a row the same name on a series the user watched twice in a day.
 * The episode number is what tells those rows apart, so it belongs in the name.
 */
function eventLabel(event: WatchEvent): string {
  const name = event.name || "this watch";
  return event.type === "episode" && event.season != null && event.episode != null
    ? `${name} S${event.season}E${event.episode}`
    : name;
}

export function HistoryPage() {
  // Only the first page goes through the cache. Appended pages are held
  // separately and merged for rendering: writing them through would grow the
  // cached entry without bound as you scroll, and — because a remount restarts
  // pagination at offset 0 — the first load back would then replace a long
  // cached list with a single page, collapsing the view.
  const [firstPage, setFirstPage, firstPageMeta] = useCachedState<WatchEvent[]>("history:events", []);
  const [extraPages, setExtraPages] = useState<WatchEvent[]>([]);
  const events = useMemo(() => [...firstPage, ...extraPages], [firstPage, extraPages]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(!firstPageMeta.hadCachedValue);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading, detail: panelDetail, detailLoading: panelDetailLoading } = useDetailPanel();

  // The filter goes to the server, not to the loaded page: filtering in memory
  // only ever saw the rows already fetched, so picking "Movies" on a history
  // whose most recent 25 events are all episodes showed an empty list.
  const loadPage = useCallback(async (nextOffset: number) => {
    const page = await api.getWatchHistory(PAGE_SIZE, nextOffset, {
      type: typeFilter === "all" ? undefined : typeFilter,
    });
    setHasMore(page.length === PAGE_SIZE);
    return page;
  }, [typeFilter]);

  // Re-runs when loadPage changes identity, i.e. whenever the filter changes —
  // pagination has to restart from 0 against the new result set.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const page = await loadPage(0);
        if (!cancelled) {
          setFirstPage(page);
          setExtraPages([]);
          setOffset(page.length);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load watch history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const page = await loadPage(offset);
      setExtraPages((prev) => [...prev, ...page]);
      setOffset((prev) => prev + page.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more history");
    } finally {
      setLoadingMore(false);
    }
  }, [loadPage, offset]);

  // Infinite scroll
  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loadingMore) void loadMore();
    }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadMore]);

  // A re-logged event can come back as one already on screen — the server folds
  // same-day identical plays into a single row's play count — so the insert is
  // keyed on id rather than appending blindly.
  const restoreEvent = (event: WatchEvent) => {
    // A restored row belongs at its date, which is within the first page for
    // anything recent — and the first page is the list that persists.
    setFirstPage((prev) =>
      prev.some((e) => e.id === event.id) || extraPages.some((e) => e.id === event.id)
        ? prev
        : [...prev, event].sort(
            (a, b) => new Date(b.watchedAt).getTime() - new Date(a.watchedAt).getTime()
          )
    );
    setOffset((prev) => prev + 1);
  };

  const handleUndoDelete = async (event: WatchEvent) => {
    try {
      restoreEvent(await relogWatchEvent(event));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not restore watch event", "error");
    }
  };

  // The delete button sits on a row whose whole surface is also a tap target and
  // renders at full opacity on touch, so a mis-tap is easy. The removal is
  // optimistic and the toast carries the way back, rather than a confirm dialog
  // gating every removal.
  const handleDelete = async (event: WatchEvent) => {
    setDeletingId(event.id);
    // The row can be in either list, so both are filtered.
    setFirstPage((prev) => prev.filter((e) => e.id !== event.id));
    setExtraPages((prev) => prev.filter((e) => e.id !== event.id));
    setOffset((prev) => prev - 1);
    try {
      await api.deleteWatchEvent(event.id);
      // Metadata is backfilled in the background, so a row can reach here
      // without a name.
      showToast(event.name ? `Removed ${event.name} from history` : "Removed from history", "info", {
        action: { label: "Undo", onAction: () => void handleUndoDelete(event) },
      });
    } catch (err) {
      restoreEvent(event);
      showToast(err instanceof Error ? err.message : "Failed to delete watch event", "error");
    } finally {
      setDeletingId(null);
    }
  };

  // A note is written when the watch is logged and was unreachable afterwards —
  // there was no way to correct or remove one from the app. Editing here writes
  // through `PATCH /watch/:eventId` and takes the row the server sends back
  // rather than the draft, so what's on screen is what was stored.
  const openNoteEditor = (event: WatchEvent) => {
    setEditingNoteId(event.id);
    setNoteDraft(event.note ?? "");
  };

  const closeNoteEditor = () => {
    setEditingNoteId(null);
    setNoteDraft("");
  };

  const handleSaveNote = async (event: WatchEvent) => {
    const note = noteDraft.trim() || null;
    if (note === (event.note ?? null)) {
      closeNoteEditor();
      return;
    }
    setSavingNote(true);
    try {
      const { watchEvent } = await api.updateWatchEventNote(event.id, note);
      const applyNote = (list: WatchEvent[]) =>
        list.map((e) => (e.id === event.id ? { ...e, note: watchEvent.note ?? null } : e));
      setFirstPage(applyNote);
      setExtraPages(applyNote);
      closeNoteEditor();
      showToast(note ? "Note saved" : "Note removed", "success");
    } catch (err) {
      // The editor stays open with the draft intact, so a failed save is a
      // retry rather than retyping.
      showToast(err instanceof Error ? err.message : "Failed to save note", "error");
    } finally {
      setSavingNote(false);
    }
  };

  const groups = useMemo(() => {
    const now = new Date();
    const result: { label: string; events: WatchEvent[] }[] = [];
    for (const event of events) {
      const label = groupLabel(new Date(event.watchedAt), now);
      const last = result[result.length - 1];
      if (last && last.label === label) {
        last.events.push(event);
      } else {
        result.push({ label, events: [event] });
      }
    }
    return result;
  }, [events]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={PAGE_TITLE} style={{ color: "var(--text)" }}>Watch History</h1>

        <div className="relative inline-flex rounded-full p-0.5" style={{ background: "var(--surface-strong)", border: "1px solid var(--border)" }}>
          {(["all", "movie", "episode"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setTypeFilter(opt)}
              className="relative rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset"
              style={
                typeFilter === opt
                  ? { background: "var(--accent)", color: "var(--on-accent)" }
                  : { color: "var(--text-dim)" }
              }
            >
              {opt === "all" ? "All" : opt === "movie" ? "Movies" : "Episodes"}
            </button>
          ))}
        </div>
      </div>

      {error && events.length > 0 && (
        <p role="alert" className="text-sm text-danger">{error}</p>
      )}

      {/* Skeletons and the failure card render in place of the list rather than
          replacing the page: switching filters now refetches, and a failed
          fetch used to take the filter pills with it, leaving no way back. */}
      {loading ? (
        // Two grouped panels rather than eight loose bars, so the shape that
        // arrives is the shape that was being waited for.
        <div className="space-y-6">
          {[4, 4].map((rows, g) => (
            <div key={g}>
              <div className="skeleton mb-2 h-3 w-24 rounded" />
              <div className="skeleton rounded-2xl" style={{ height: `${rows * 4.25}rem` }} />
            </div>
          ))}
        </div>
      ) : error && events.length === 0 ? (
        <div className="mx-auto max-w-lg rounded-2xl p-8 text-center" style={{ border: "1px solid rgba(244,63,94,0.2)", background: "rgba(244,63,94,0.05)" }}>
          <AlertCircle className="mx-auto h-12 w-12 text-danger" />
          <p role="alert" className={`mt-3 ${SECTION_TITLE} text-danger`}>{error}</p>
        </div>
      ) : events.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8 text-center" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
          <Calendar className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
          <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>
            {typeFilter === "movie"
              ? "No movies in your watch history yet."
              : typeFilter === "episode"
                ? "No episodes in your watch history yet."
                : "No watch history yet."}
            {" "}Anything you mark watched is logged here.
          </p>
          {/* The search page is the way out of this one: a brand-new install
              lands here with nothing to filter and no other route onward. */}
          <Link to="/search" className="mt-1 inline-block text-sm font-medium text-claw-text underline-offset-2 transition-colors hover:underline">
            Find something to watch &rarr;
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={`${group.label}-${group.events[0].id}`}>
              <h2 className={`mb-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>
                {group.label}
              </h2>
              {/* One surface per date group, with hairlines between the rows.
                  Every row used to be its own bordered, rounded card with a gap
                  to the next, so a normal amount of history stacked 25+ outlined
                  containers down the page and the dominant visual element was
                  border rather than content. The date grouping was already doing
                  the work of making this scannable; it just needed to own the
                  surface too. */}
              <div
                className="glass-panel overflow-hidden rounded-2xl"
                style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}
              >
              {group.events.map((event, i) => (
                <div key={event.id} style={i > 0 ? { borderTop: "1px solid var(--border)" } : undefined}>
                <div
                  // Not .glass-row: the group container is the .glass-panel now,
                  // and a row inside it would stack a second blurred layer per
                  // row and re-tint each one with `!important` — putting the
                  // wall of separate surfaces back on the Glass theme. Its only
                  // other job was restoring the hover answer that an inline
                  // `background` used to beat, and there is no longer one here.
                  //
                  // The row is a plain container, not a control. It used to be a
                  // role="button" with the note and delete buttons inside it —
                  // a button nested in a button, which has no defined mapping
                  // and which assistive tech resolves differently from one
                  // implementation to the next. What opens the panel is now the
                  // overlay below, a sibling of the two action buttons rather
                  // than their ancestor.
                  className="group relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--surface-strong)]"
                >
                  {/* Fills the row behind its content, so the whole row is still
                      one click target and still takes the inset ring on focus.
                      The content is `pointer-events-none` so clicks fall through
                      to this; the two action buttons opt back in and stack above
                      it. */}
                  <button
                    type="button"
                    onClick={() => setSelectedItem(toSearchResult(event))}
                    aria-label={`View details for ${eventLabel(event)}`}
                    className="absolute inset-0 z-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                  />

                  {/* A 2:3 box, so a poster fills it instead of being cropped to
                      a square through its middle — the old 48px square showed a
                      band across the artwork that identified nothing. 40x60 is
                      as small as a poster can be and still be recognisable, and
                      it keeps the row close to the height it had. */}
                  <div
                    className="pointer-events-none flex aspect-poster w-10 flex-none items-center justify-center overflow-hidden rounded-lg"
                    style={{ background: "var(--surface-strong)" }}
                  >
                    {event.poster ? (
                      <img src={event.poster} alt={event.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : event.type === "movie" ? (
                      <Film className="h-5 w-5" style={{ color: "var(--text-mute)" }} />
                    ) : (
                      <Tv className="h-5 w-5" style={{ color: "var(--text-mute)" }} />
                    )}
                  </div>

                  <div className="pointer-events-none relative min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                      {event.name}
                      {event.type === "episode" && event.season != null && event.episode != null && (
                        <span style={{ color: "var(--text-mute)" }}>
                          {" "}S{event.season}E{event.episode}
                        </span>
                      )}
                    </p>
                    <p className="text-2xs" style={{ color: "var(--text-mute)" }}>
                      {new Date(event.watchedAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                    {event.note && editingNoteId !== event.id && (
                      <p className="mt-1 whitespace-pre-wrap text-xs italic" style={{ color: "var(--text-dim)" }}>
                        {event.note}
                      </p>
                    )}
                  </div>

                  {/* `relative z-10` puts these above the row overlay, which
                      would otherwise take the click. They no longer need to stop
                      the event: the overlay is a sibling, so nothing bubbles
                      from here to it. */}
                  <button
                    type="button"
                    onClick={() => openNoteEditor(event)}
                    className="relative z-10 flex h-9 w-9 flex-none items-center justify-center rounded-lg opacity-100 transition-all duration-fast sm:opacity-0 sm:group-hover:opacity-100 hover:bg-[var(--surface-strong)] focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset"
                    aria-label={event.note ? `Edit note on ${eventLabel(event)}` : `Add note to ${eventLabel(event)}`}
                    title={event.note ? "Edit note" : "Add note"}
                  >
                    <NotebookPen aria-hidden="true" className="h-4 w-4" style={{ color: event.note ? "var(--accent-text)" : "var(--text-mute)" }} />
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDelete(event)}
                    disabled={deletingId === event.id}
                    className="relative z-10 flex h-9 w-9 flex-none items-center justify-center rounded-lg opacity-100 transition-all duration-fast sm:opacity-0 sm:group-hover:opacity-100 hover:bg-rose-500/10 disabled:opacity-50 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-ring-offset"
                    aria-label={`Delete watch of ${eventLabel(event)}`}
                    title="Remove from history"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4 text-danger dark:text-danger" />
                  </button>
                </div>

                {/* Outside the row, which is itself a button: a field nested in
                    one would open the detail panel on every click into it. */}
                {editingNoteId === event.id && (
                  <div className="px-3 pb-3">
                    <label className="sr-only" htmlFor={`note-${event.id}`}>
                      Note on {event.name || "this watch"}
                    </label>
                    <textarea
                      id={`note-${event.id}`}
                      autoFocus
                      rows={2}
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeNoteEditor(); } }}
                      placeholder="What did you think?"
                      className="w-full resize-y rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
                      style={{ border: "1px solid var(--border)", background: "var(--bg-0)", color: "var(--text)" }}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" className="btn-secondary btn-sm" onClick={closeNoteEditor} disabled={savingNote}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => void handleSaveNote(event)}
                        disabled={savingNote}
                      >
                        {savingNote ? "Saving…" : "Save note"}
                      </button>
                    </div>
                  </div>
                )}
                </div>
              ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {loadingMore && (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>Loading...</p>
          )}
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
          onHistoryChange={(updated) => setPanelHistory(updated)}
          onSelectItem={setSelectedItem}
        />
      )}
    </div>
  );
}
