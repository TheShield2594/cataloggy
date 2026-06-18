import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Calendar, Film, Trash2, Tv } from "lucide-react";
import { api, WatchEvent } from "../api";

const PAGE_SIZE = 25;

export function HistoryPage() {
  const [events, setEvents] = useState<WatchEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const loadMore = async () => {
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
  };

  const handleDelete = async (eventId: string) => {
    setDeletingId(eventId);
    try {
      await api.deleteWatchEvent(eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      setOffset((prev) => prev - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete watch event");
    } finally {
      setDeletingId(null);
    }
  };

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
      <h2 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Watch History</h2>

      {error && (
        <p className="text-sm text-rose-500">{error}</p>
      )}

      {events.length === 0 ? (
        <div className="rounded-2xl p-8 text-center" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
          <Calendar className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
          <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>No watch history yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-center gap-3 rounded-xl p-3"
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
                onClick={() => handleDelete(event.id)}
                disabled={deletingId === event.id}
                className="flex h-9 w-9 flex-none items-center justify-center rounded-lg transition-colors hover:bg-rose-500/10 disabled:opacity-50"
                aria-label="Delete watch event"
                title="Remove from history"
              >
                <Trash2 className="h-4 w-4 text-rose-500" />
              </button>
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full rounded-xl py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-strong)] disabled:opacity-50"
          style={{ border: "1px solid var(--border)", color: "var(--text-dim)" }}
        >
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
