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
    <div className="grid grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5"
        >
          <div className="skeleton mb-3 h-8 w-16 rounded-lg" />
          <div className="skeleton h-4 w-24 rounded" />
        </div>
      ))}
    </div>
  );
}

function ContinueWatchingSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden pb-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex-none">
          <div className="skeleton h-44 w-[7.5rem] rounded-xl" />
          <div className="skeleton mt-2 h-3.5 w-24 rounded" />
          <div className="skeleton mt-1 h-3 w-16 rounded" />
          <div className="skeleton mt-2 h-8 w-[7.5rem] rounded-lg" />
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
          className="flex items-center gap-3 rounded-xl border border-slate-800/40 bg-slate-900/40 p-3"
        >
          <div className="skeleton h-16 w-11 flex-none rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-36 rounded" />
            <div className="skeleton h-3 w-20 rounded" />
          </div>
          <div className="skeleton h-3 w-14 rounded" />
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
      className={`flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 ${className}`}
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
      <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-8 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-rose-400" />
        <p className="text-xl font-semibold text-rose-300">
          Unable to connect to the API
        </p>
        <p className="text-sm text-slate-400">{error}</p>
        <p className="text-sm text-slate-500">
          Current API base:{" "}
          <span className="font-mono text-red-300">
            {runtimeConfig.getApiBase()}
          </span>
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-red-500 px-5 py-2.5 text-sm font-semibold hover:bg-red-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-300 focus-visible:ring-offset-slate-900"
          >
            Reload
          </button>
          <Link
            to="/settings"
            className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-500 focus-visible:ring-offset-slate-900"
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
          gradient: "from-red-500/10 to-transparent",
          iconColor: "text-red-400",
          borderColor: "border-red-500/20",
        },
        {
          label: "Episodes Watched",
          value: stats.totalEpisodes,
          icon: Tv,
          gradient: "from-violet-500/10 to-transparent",
          iconColor: "text-violet-400",
          borderColor: "border-violet-500/20",
        },
        {
          label: "Total Plays",
          value: stats.totalPlays,
          icon: Play,
          gradient: "from-amber-500/10 to-transparent",
          iconColor: "text-amber-400",
          borderColor: "border-amber-500/20",
        },
      ]
    : null;

  return (
    <div className="space-y-10">
      {/* ── Stats ── */}
      <section>
        {loading ? (
          <StatsSkeleton />
        ) : statsCards ? (
          <div className="grid grid-cols-3 gap-4">
            {statsCards.map((card) => (
              <div
                key={card.label}
                className={`rounded-2xl border ${card.borderColor} bg-gradient-to-br ${card.gradient} bg-slate-900/40 p-5 transition-colors hover:bg-slate-900/60`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800/80 ${card.iconColor}`}>
                    <card.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-white tabular-nums">
                      {card.value.toLocaleString()}
                    </span>
                    <p className="text-xs text-slate-400 font-medium">{card.label}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── Continue Watching ── */}
      <section>
        <h2 className="mb-4 text-xl font-bold">
          Continue Watching
        </h2>
        {loading ? (
          <ContinueWatchingSkeleton />
        ) : progress.length === 0 ? (
          <p className="text-sm text-slate-500">
            No series in progress. Start watching something!
          </p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
            {progress.map((s) => {
              const isMarking = markingNext.has(s.imdbId);
              const isDone = markedDone.has(s.imdbId);
              return (
                <div key={s.imdbId} className="flex-none snap-start group">
                  <div className="relative h-44 w-[7.5rem] overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10 transition-all duration-300 group-hover:shadow-card-hover group-hover:scale-[1.03]">
                    <Poster
                      src={s.poster}
                      alt={s.name}
                      className="h-full w-full"
                    />
                    {/* Bottom gradient with episode info */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-2.5 pb-2.5 pt-8">
                      <p className="text-2xs font-semibold text-slate-200">
                        S{s.lastSeason}:E{s.lastEpisode}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 w-[7.5rem] truncate text-sm font-medium text-slate-200">
                    {s.name}
                  </p>
                  <button
                    type="button"
                    disabled={isMarking || isDone}
                    onClick={() => void handleMarkNext(s.imdbId)}
                    className={`mt-2 flex w-[7.5rem] items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-all ${
                      isDone
                        ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20"
                        : isMarking
                          ? "bg-slate-800 text-slate-400"
                          : "bg-red-500/15 text-red-400 ring-1 ring-red-500/20 hover:bg-red-500/25"
                    }`}
                  >
                    {isDone ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Marked
                      </>
                    ) : isMarking ? (
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                    ) : (
                      <>
                        <ChevronRight className="h-3.5 w-3.5" />
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
        <h2 className="mb-4 text-xl font-bold">
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
                className="flex items-center gap-4 rounded-xl border border-slate-800/40 bg-slate-900/30 p-3 transition-all hover:bg-slate-900/60 hover:border-slate-700/60"
              >
                <div className="h-16 w-11 flex-none overflow-hidden rounded-lg ring-1 ring-white/5">
                  <Poster
                    src={event.poster}
                    alt={event.name}
                    className="h-full w-full"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {event.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {event.type === "series" &&
                    event.season != null &&
                    event.episode != null
                      ? `S${event.season}:E${event.episode}`
                      : event.type === "movie"
                        ? "Movie"
                        : ""}
                  </p>
                </div>
                <span className="flex-none rounded-full bg-slate-800/60 px-2.5 py-1 text-2xs font-medium text-slate-400">
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
