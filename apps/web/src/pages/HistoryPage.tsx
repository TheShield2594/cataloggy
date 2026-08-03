import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Calendar, Film, Trash2, Tv } from "lucide-react";
import { api, SearchResult, WatchEvent } from "../api";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { useToast } from "../hooks/useToast";

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

export function HistoryPage() {
  const [events, setEvents] = useState<WatchEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading } = useDetailPanel();

  const loadPage = useCallback(async (nextOffset: number) => {
    const page = await api.getWatchHistory(PAGE_SIZE, nextOffset);
    setHasMore(page.length === PAGE_SIZE);
    return page;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await loadPage(0);
        if (!cancelled) {
          setEvents(page);
          setOffset(page.length);
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
      setEvents((prev) => [...prev, ...page]);
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

  const handleDelete = async (eventId: string) => {
    setDeletingId(eventId);
    try {
      await api.deleteWatchEvent(eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      setOffset((prev) => prev - 1);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete watch event", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const filteredEvents = useMemo(
    () => (typeFilter === "all" ? events : events.filter((e) => e.type === typeFilter)),
    [events, typeFilter]
  );

  const groups = useMemo(() => {
    const now = new Date();
    const result: { label: string; events: WatchEvent[] }[] = [];
    for (const event of filteredEvents) {
      const label = groupLabel(new Date(event.watchedAt), now);
      const last = result[result.length - 1];
      if (last && last.label === label) {
        last.events.push(event);
      } else {
        result.push({ label, events: [event] });
      }
    }
    return result;
  }, [filteredEvents]);

  if (error && events.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl p-8 text-center" style={{ border: "1px solid rgba(244,63,94,0.2)", background: "rgba(244,63,94,0.05)" }}>
        <AlertCircle className="mx-auto h-12 w-12 text-rose-500" />
        <p className="mt-3 text-lg font-semibold text-rose-500">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <h2 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Watch History</h2>
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Watch History</h2>

        <div className="relative inline-flex rounded-full p-0.5" style={{ background: "var(--surface-strong)", border: "1px solid var(--border)" }}>
          {(["all", "movie", "episode"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setTypeFilter(opt)}
              className="relative rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2"
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

      {error && (
        <p className="text-sm text-rose-500">{error}</p>
      )}

      {filteredEvents.length === 0 ? (
        <div className="rounded-2xl p-8 text-center" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
          <Calendar className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
          <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>No watch history yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={`${group.label}-${group.events[0].id}`} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
                {group.label}
              </h3>
              {group.events.map((event) => (
                <div
                  key={event.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedItem(toSearchResult(event))}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedItem(toSearchResult(event)); } }}
                  className="group flex cursor-pointer items-center gap-3 rounded-xl p-3 transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2"
                  style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}
                >
                  <div
                    className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-lg"
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

                  <div className="min-w-0 flex-1">
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
                  </div>

                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDelete(event.id); }}
                    disabled={deletingId === event.id}
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg opacity-100 transition-all sm:opacity-0 sm:group-hover:opacity-100 hover:bg-rose-500/10 disabled:opacity-50 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2"
                    aria-label="Delete watch event"
                    title="Remove from history"
                  >
                    <Trash2 className="h-4 w-4 text-rose-500" />
                  </button>
                </div>
              ))}
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
          onClose={() => setSelectedItem(null)}
          onShowToast={showToast}
          onHistoryChange={(updated) => setPanelHistory(updated)}
          onSelectItem={setSelectedItem}
        />
      )}
    </div>
  );
}
