import { useEffect, useState, useCallback } from "react";
import {
  AlertCircle,
  Film,
  Tv,
  Play,
  ChevronRight,
  Check,
} from "lucide-react";
import {
  api,
  runtimeConfig,
  SeriesProgress,
  WatchEvent,
  WatchStats,
} from "../api";
import { Link } from "react-router-dom";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/* ─── Skeleton placeholders ─── */

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
        >
          <div className="skeleton mb-2 h-7 w-16 rounded" />
          <div className="skeleton h-3.5 w-24 rounded" />
        </div>
      ))}
    </div>
  );
}

function ContinueWatchingSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden pb-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex-none">
          <div className="skeleton h-40 w-28 rounded-xl" />
          <div className="skeleton mt-1.5 h-3 w-24 rounded" />
          <div className="skeleton mt-1 h-2.5 w-16 rounded" />
          <div className="skeleton mt-1.5 h-7 w-28 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function RecentlyWatchedSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-slate-800/50 bg-slate-900/40 p-2.5"
        >
          <div className="skeleton h-14 w-10 flex-none rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-3.5 w-32 rounded" />
            <div className="skeleton h-2.5 w-20 rounded" />
          </div>
          <div className="skeleton h-2.5 w-14 rounded" />
        </div>
      ))}
    </div>
  );
}

/* ─── Poster component ─── */

function Poster({
  src,
  alt,
  className = "",
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  return src ? (
    <img
      src={src}
      alt={alt}
      className={`object-cover ${className}`}
      loading="lazy"
    />
  ) : (
    <div
      className={`flex items-center justify-center bg-slate-800 ${className}`}
    >
      <Film className="h-6 w-6 text-slate-600" />
    </div>
  );
}

/* ─── Main component ─── */

export function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [progress, setProgress] = useState<SeriesProgress[]>([]);
  const [history, setHistory] = useState<WatchEvent[]>([]);
  const [stats, setStats] = useState<WatchStats | null>(null);

  const [markingNext, setMarkingNext] = useState<Set<string>>(new Set());
  const [markedDone, setMarkedDone] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [progressRes, historyRes, statsRes] = await Promise.all([
        api.getSeriesProgress(),
        api.getWatchHistory(10),
        api.getWatchStats(),
      ]);
      setProgress(progressRes);
      setHistory(historyRes);
      setStats(statsRes);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load dashboard",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMarkNext = async (imdbId: string) => {
    setMarkingNext((prev) => new Set(prev).add(imdbId));
    try {
      await api.markNextEpisodeWatched(imdbId);
      setMarkedDone((prev) => new Set(prev).add(imdbId));
      // Refresh data after a brief moment so the user sees the checkmark
      setTimeout(() => {
        setMarkedDone((prev) => {
          const next = new Set(prev);
          next.delete(imdbId);
          return next;
        });
        void load();
      }, 1200);
    } catch {
      // silently fail — button returns to normal
    } finally {
      setMarkingNext((prev) => {
        const next = new Set(prev);
        next.delete(imdbId);
        return next;
      });
    }
  };

  /* ─── Error state ─── */
  if (error) {
    return (
      <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-rose-400" />
        <p className="text-lg font-medium text-rose-300">
          Unable to connect to the API
        </p>
        <p className="text-sm text-slate-300">{error}</p>
        <p className="text-sm text-slate-400">
          Current API base:{" "}
          <span className="font-mono text-sky-300">
            {runtimeConfig.getApiBase()}
          </span>
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
          >
            Reload
          </button>
          <Link
            to="/settings"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Settings
          </Link>
        </div>
      </div>
    );
  }

  /* ─── Stats row ─── */
  const statsCards = stats
    ? [
        {
          label: "Movies Watched",
          value: stats.totalMovies,
          icon: Film,
          color: "text-sky-400",
        },
        {
          label: "Episodes Watched",
          value: stats.totalEpisodes,
          icon: Tv,
          color: "text-violet-400",
        },
        {
          label: "Total Plays",
          value: stats.totalPlays,
          icon: Play,
          color: "text-emerald-400",
        },
      ]
    : null;

  return (
    <div className="space-y-8">
      {/* ── Stats ── */}
      <section>
        {loading ? (
          <StatsSkeleton />
        ) : statsCards ? (
          <div className="grid grid-cols-3 gap-3">
            {statsCards.map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
              >
                <div className="flex items-center gap-2">
                  <card.icon className={`h-4 w-4 ${card.color}`} />
                  <span className="text-2xl font-bold font-heading text-slate-100 tabular-nums">
                    {card.value.toLocaleString()}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">{card.label}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── Continue Watching ── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold font-heading">
          Continue Watching
        </h2>
        {loading ? (
          <ContinueWatchingSkeleton />
        ) : progress.length === 0 ? (
          <p className="text-sm text-slate-500">
            No series in progress. Start watching something!
          </p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
            {progress.map((s) => {
              const isMarking = markingNext.has(s.imdbId);
              const isDone = markedDone.has(s.imdbId);
              return (
                <div key={s.imdbId} className="flex-none snap-start">
                  <div className="relative h-40 w-28 overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10">
                    <Poster
                      src={s.poster}
                      alt={s.name}
                      className="h-full w-full"
                    />
                    {/* Bottom gradient with episode info */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-2 pb-2 pt-6">
                      <p className="text-2xs font-medium text-slate-300">
                        S{s.lastSeason}:E{s.lastEpisode}
                      </p>
                    </div>
                  </div>
                  <p className="mt-1.5 w-28 truncate text-xs font-medium text-slate-200">
                    {s.name}
                  </p>
                  <button
                    type="button"
                    disabled={isMarking || isDone}
                    onClick={() => void handleMarkNext(s.imdbId)}
                    className={`mt-1.5 flex w-28 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-2xs font-medium transition-colors ${
                      isDone
                        ? "bg-emerald-600/20 text-emerald-400"
                        : isMarking
                          ? "bg-slate-700/50 text-slate-400"
                          : "bg-sky-600/20 text-sky-400 hover:bg-sky-600/40"
                    }`}
                  >
                    {isDone ? (
                      <>
                        <Check className="h-3 w-3" /> Marked
                      </>
                    ) : isMarking ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                    ) : (
                      <>
                        <ChevronRight className="h-3 w-3" />
                        S{s.nextSeason}:E{s.nextEpisode}
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Recently Watched ── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold font-heading">
          Recently Watched
        </h2>
        {loading ? (
          <RecentlyWatchedSkeleton />
        ) : history.length === 0 ? (
          <p className="text-sm text-slate-500">No watch history yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-3 rounded-xl border border-slate-800/50 bg-slate-900/40 p-2.5 transition-colors hover:bg-slate-900/70"
              >
                <div className="h-14 w-10 flex-none overflow-hidden rounded-lg ring-1 ring-white/5">
                  <Poster
                    src={event.poster}
                    alt={event.name}
                    className="h-full w-full"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-200">
                    {event.name}
                  </p>
                  <p className="text-2xs text-slate-500">
                    {event.type === "series" &&
                    event.season != null &&
                    event.episode != null
                      ? `S${event.season}:E${event.episode}`
                      : event.type === "movie"
                        ? "Movie"
                        : ""}
                  </p>
                </div>
                <span className="flex-none text-2xs text-slate-500">
                  {timeAgo(event.watchedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
