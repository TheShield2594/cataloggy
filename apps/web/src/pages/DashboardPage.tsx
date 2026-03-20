import { useEffect, useState, useCallback, useMemo } from "react";
import {
  AlertCircle,
  Film,
  Tv,
  Play,
  ChevronRight,
  ChevronLeft,
  Check,
  Radio,
  Star,
  TrendingUp,
  Sparkles,
  X,
} from "lucide-react";
import {
  api,
  CalendarEntry,
  CheckIn,
  runtimeConfig,
  SearchResult,
  SeriesProgress,
  TrendingMeta,
  WatchEvent,
  WatchStats,
} from "../api";
import { Link } from "react-router-dom";
import { useHorizontalScroll, getInitials, getGradient } from "../components/carousel-utils";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";

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
    <div className="flex items-center gap-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="skeleton h-5 w-5 rounded" />
          <div className="skeleton h-5 w-12 rounded" />
          <div className="skeleton h-4 w-20 rounded" />
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
          <div className="skeleton h-[16.5rem] w-[11rem] rounded-xl" />
          <div className="skeleton mt-2.5 h-4 w-32 rounded" />
          <div className="skeleton mt-1.5 h-3 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}

function RecentlyWatchedSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden pb-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex-none">
          <div className="skeleton h-[16.5rem] w-[11rem] rounded-xl" />
          <div className="skeleton mt-2.5 h-4 w-28 rounded" />
          <div className="skeleton mt-1.5 h-3 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

/* ─── Poster component with initials fallback ─── */

function Poster({
  src,
  alt,
  className = "",
}: {
  src?: string;
  alt: string | null | undefined;
  className?: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);

  // Reset failure state when src changes
  useEffect(() => { setLoadFailed(false); }, [src]);

  if (!src || loadFailed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br ${getGradient(alt)} ${className}`}
      >
        <span className="text-xl font-bold text-white/40 select-none">
          {getInitials(alt)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? "Poster"}
      className={`object-cover ${className}`}
      loading="lazy"
      onError={() => setLoadFailed(true)}
    />
  );
}

/* ─── Discovery Card (shared by trending + recommendations) ─── */

type DiscoveryItem = {
  id: string;
  name: string;
  poster?: string;
  rating?: number;
  genres?: string[];
  year?: number;
  type?: string;
};

function DiscoveryCard({ item, badge, onSelect }: { item: DiscoveryItem; badge?: React.ReactNode; onSelect?: (item: DiscoveryItem) => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="flex-none group cursor-pointer"
      style={{ width: "11rem" }}
      onClick={() => onSelect?.(item)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(item); } }}
      aria-label={`View details for ${item.name}`}
    >
      <div className="relative overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10 transition-all duration-300 group-hover:shadow-card-hover group-hover:ring-white/20" style={{ aspectRatio: "2 / 3" }}>
        <Poster src={item.poster} alt={item.name} className="h-full w-full" />
        {item.rating != null && item.rating > 0 && (
          <div className="absolute top-2.5 left-2.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-0.5 text-2xs font-semibold text-amber-400 backdrop-blur-sm">
              <Star className="h-2.5 w-2.5 fill-amber-400" />
              {item.rating.toFixed(1)}
            </span>
          </div>
        )}
        {badge && <div className="absolute top-2.5 right-2.5">{badge}</div>}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/60 to-transparent px-3 pb-3 pt-10">
          {item.genres && item.genres.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.genres.slice(0, 2).map((g) => (
                <span key={g} className="rounded bg-white/10 px-1.5 py-0.5 text-2xs text-slate-300 backdrop-blur-sm">{g}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="mt-2.5 truncate text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">{item.name}</p>
      <p className="text-2xs text-slate-500">
        {item.year ?? ""}{item.type ? ` ${item.type === "movie" ? "Movie" : "Series"}` : ""}
      </p>
    </div>
  );
}

/* ─── Scroll Arrow Buttons ─── */

function ScrollArrows({
  canScrollLeft,
  canScrollRight,
  onScroll,
}: {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  onScroll: (dir: "left" | "right") => void;
}) {
  if (!canScrollLeft && !canScrollRight) return null;
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onScroll("left")}
        disabled={!canScrollLeft}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700/60 bg-slate-900/80 text-slate-400 transition-all hover:border-slate-600 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:cursor-default disabled:hover:border-slate-700/60 disabled:hover:bg-slate-900/80 disabled:hover:text-slate-400"
        aria-label="Scroll left"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onScroll("right")}
        disabled={!canScrollRight}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700/60 bg-slate-900/80 text-slate-400 transition-all hover:border-slate-600 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:cursor-default disabled:hover:border-slate-700/60 disabled:hover:bg-slate-900/80 disabled:hover:text-slate-400"
        aria-label="Scroll right"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ─── Section header ─── */

function SectionHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-slate-800/80 px-2.5 py-0.5 text-xs font-medium text-slate-400 tabular-nums">
            {count}
          </span>
        )}
      </div>
      {children}
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

  const [trendingMovies, setTrendingMovies] = useState<TrendingMeta[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<TrendingMeta[]>([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [seriesRecs, setSeriesRecs] = useState<TrendingMeta[]>([]);
  const [seriesRecsLoading, setSeriesRecsLoading] = useState(true);
  const [calendarEntries, setCalendarEntries] = useState<CalendarEntry[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(true);

  const [markingNext, setMarkingNext] = useState<Set<string>>(new Set());
  const [markedDone, setMarkedDone] = useState<Set<string>>(new Set());

  const [activeCheckin, setActiveCheckin] = useState<CheckIn | null>(null);

  const continueScroll = useHorizontalScroll();
  const recentScroll = useHorizontalScroll();
  const trendingScroll = useHorizontalScroll();
  const recsScroll = useHorizontalScroll();
  const seriesRecsScroll = useHorizontalScroll();

  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading } = useDetailPanel();

  const toSearchResult = useCallback((imdbId: string, type: "movie" | "series", name: string, opts?: {
    poster?: string; year?: number | null; description?: string | null; genres?: string[]; rating?: number | null;
  }): SearchResult => ({
    imdbId, type, name,
    year: opts?.year ?? null,
    poster: opts?.poster ?? null,
    description: opts?.description ?? null,
    genres: opts?.genres ?? [],
    rating: opts?.rating ?? null,
    inWatchlist: false,
    lists: [],
  }), []);

  const emptyListMap = useMemo(() => new Map(), []);

  const load = useCallback(async () => {
    try {
      const [progressRes, historyRes, statsRes, checkinRes] = await Promise.all([
        api.getSeriesProgress(),
        api.getWatchHistory(20),
        api.getWatchStats(),
        api.getCheckin().catch(() => ({ checkin: null })),
      ]);
      setProgress(progressRes ?? []);
      setHistory(historyRes ?? []);
      setStats(statsRes);
      setActiveCheckin(checkinRes.checkin);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load dashboard",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Load discovery data separately (non-blocking)
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await api.getTrending("movie", "week");
        if (mounted) setTrendingMovies(res.metas ?? []);
      } catch { /* optional */ } finally {
        if (mounted) setTrendingLoading(false);
      }
    })();
    void (async () => {
      try {
        const res = await api.getPersonalRecommendations("movie", 20);
        if (mounted) setRecommendations(res.metas ?? []);
      } catch { /* optional */ } finally {
        if (mounted) setRecsLoading(false);
      }
    })();
    void (async () => {
      try {
        const res = await api.getPersonalRecommendations("series", 20);
        if (mounted) setSeriesRecs(res.metas ?? []);
      } catch { /* optional */ } finally {
        if (mounted) setSeriesRecsLoading(false);
      }
    })();
    void (async () => {
      try {
        const res = await api.getCalendar(14);
        if (mounted) setCalendarEntries(res.calendar ?? []);
      } catch { /* optional */ } finally {
        if (mounted) setCalendarLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-check scroll arrows after data loads
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      continueScroll.checkScroll();
      recentScroll.checkScroll();
      trendingScroll.checkScroll();
      recsScroll.checkScroll();
      seriesRecsScroll.checkScroll();
    }, 50);
    return () => clearTimeout(timer);
  }, [loading, trendingLoading, recsLoading, seriesRecsLoading, progress.length, history.length, continueScroll.checkScroll, recentScroll.checkScroll, trendingScroll.checkScroll, recsScroll.checkScroll, seriesRecsScroll.checkScroll]);

  const handleMarkNext = async (imdbId: string) => {
    setMarkingNext((prev) => new Set(prev).add(imdbId));
    try {
      await api.markNextEpisodeWatched(imdbId);
      setMarkedDone((prev) => new Set(prev).add(imdbId));
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

  const handleCheckout = async (logWatch: boolean) => {
    await api.endCheckin(logWatch);
    setActiveCheckin(null);
    if (logWatch) void load();
  };

  return (
    <div className="space-y-10">
      {/* ── Now Watching Banner ── */}
      {activeCheckin && (
        <div className="flex items-center gap-4 rounded-2xl border border-red-500/30 bg-red-500/5 px-5 py-4">
          {activeCheckin.poster && (
            <div className="h-14 w-10 flex-none overflow-hidden rounded-lg ring-1 ring-white/10">
              <img src={activeCheckin.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-red-400">Now Watching</span>
            </div>
            <p className="mt-0.5 truncate text-sm font-semibold text-white">{activeCheckin.name}</p>
            {activeCheckin.season != null && activeCheckin.episode != null && (
              <p className="text-xs text-slate-400">
                S{String(activeCheckin.season).padStart(2, "0")}:E{String(activeCheckin.episode).padStart(2, "0")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-none">
            <button
              type="button"
              onClick={() => void handleCheckout(true)}
              className="flex items-center gap-1.5 rounded-xl bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600 transition-colors"
            >
              <Check className="h-3.5 w-3.5" /> Finished
            </button>
            <button
              type="button"
              onClick={() => void handleCheckout(false)}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
              aria-label="Check out without logging"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Inline stats bar ── */}
      <section>
        {loading ? (
          <StatsSkeleton />
        ) : stats ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <Film className="h-4 w-4 text-red-400" />
              <span className="text-lg font-bold text-white tabular-nums">{stats.totalMovies.toLocaleString()}</span>
              <span className="text-sm text-slate-500">movies</span>
            </div>
            <div className="h-4 w-px bg-slate-800" />
            <div className="flex items-center gap-2">
              <Tv className="h-4 w-4 text-violet-400" />
              <span className="text-lg font-bold text-white tabular-nums">{stats.totalEpisodes.toLocaleString()}</span>
              <span className="text-sm text-slate-500">episodes</span>
            </div>
            <div className="h-4 w-px bg-slate-800" />
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-amber-400" />
              <span className="text-lg font-bold text-white tabular-nums">{stats.totalPlays.toLocaleString()}</span>
              <span className="text-sm text-slate-500">total plays</span>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Continue Watching ── */}
      <section>
        <SectionHeader title="Continue Watching" count={progress.length}>
          {!loading && progress.length > 0 && (
            <ScrollArrows
              canScrollLeft={continueScroll.canScrollLeft}
              canScrollRight={continueScroll.canScrollRight}
              onScroll={continueScroll.scroll}
            />
          )}
        </SectionHeader>
        {loading ? (
          <ContinueWatchingSkeleton />
        ) : progress.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 py-12 text-center">
            <Tv className="mx-auto h-10 w-10 text-slate-700" />
            <p className="mt-3 text-sm text-slate-500">
              No series in progress. Start watching something!
            </p>
          </div>
        ) : (
          <div
            ref={continueScroll.ref}
            className="flex gap-4 overflow-x-auto pb-2 scroll-smooth scrollbar-hide"
          >
            {progress.map((s) => {
              const isMarking = markingNext.has(s.imdbId);
              const isDone = markedDone.has(s.imdbId);
              const progressPct =
                typeof s.watchedEpisodes === "number" && s.totalEpisodes && s.totalEpisodes > 0
                  ? Math.min(Math.max((s.watchedEpisodes / s.totalEpisodes) * 100, 0), 100)
                  : null;
              return (
                <div key={s.imdbId} className="flex-none group" style={{ width: "11rem" }}>
                  <div className="relative overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10 transition-all duration-300 group-hover:shadow-card-hover group-hover:ring-white/20" style={{ aspectRatio: "2 / 3" }}>
                    <Poster
                      src={s.poster}
                      alt={s.name}
                      className="h-full w-full"
                    />
                    {/* Clickable overlay to open detail panel */}
                    <button
                      type="button"
                      className="absolute inset-0 cursor-pointer"
                      aria-label={`View details for ${s.name}`}
                      onClick={() => setSelectedItem(toSearchResult(s.imdbId, "series", s.name, { poster: s.poster }))}
                    />
                    {/* Bottom gradient overlay with episode info + mark button */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-16">
                      {/* Progress bar */}
                      {progressPct !== null && (
                        <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-white/15">
                          <div
                            className="h-full rounded-full bg-red-500 transition-all duration-500"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      )}
                      <p className="text-xs text-slate-400">
                        S{s.lastSeason}:E{s.lastEpisode}
                        {s.totalSeasons ? ` · ${s.totalSeasons} seasons` : ""}
                      </p>
                      {/* Mark next button */}
                      <button
                        type="button"
                        disabled={isMarking || isDone}
                        onClick={() => void handleMarkNext(s.imdbId)}
                        aria-label={isMarking ? "Marking next episode" : isDone ? "Episode marked" : `Mark S${s.nextSeason}:E${s.nextEpisode}`}
                        className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
                          isDone
                            ? "bg-emerald-500/20 text-emerald-400"
                            : isMarking
                              ? "bg-slate-800/80 text-slate-400"
                              : "bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
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
                            Mark S{s.nextSeason}:E{s.nextEpisode}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mt-2.5 block truncate text-sm font-semibold text-slate-200 hover:text-white transition-colors text-left w-full"
                    onClick={() => setSelectedItem(toSearchResult(s.imdbId, "series", s.name, { poster: s.poster }))}
                  >
                    {s.name}
                  </button>
                  {progressPct !== null && (
                    <p className="text-2xs text-slate-500">
                      {s.watchedEpisodes} of {s.totalEpisodes} episodes
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Recently Watched ── */}
      <section>
        <SectionHeader title="Recently Watched" count={history.length}>
          {!loading && history.length > 0 && (
            <ScrollArrows
              canScrollLeft={recentScroll.canScrollLeft}
              canScrollRight={recentScroll.canScrollRight}
              onScroll={recentScroll.scroll}
            />
          )}
        </SectionHeader>
        {loading ? (
          <RecentlyWatchedSkeleton />
        ) : history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 py-12 text-center">
            <Film className="mx-auto h-10 w-10 text-slate-700" />
            <p className="mt-3 text-sm text-slate-500">No watch history yet.</p>
          </div>
        ) : (
          <div
            ref={recentScroll.ref}
            className="flex gap-4 overflow-x-auto pb-2 scroll-smooth scrollbar-hide"
          >
            {history.map((event) => (
              <div
                key={event.id}
                role="button"
                tabIndex={0}
                className="flex-none group cursor-pointer"
                style={{ width: "11rem" }}
                onClick={() => setSelectedItem(toSearchResult(
                  event.imdbId,
                  event.type === "movie" ? "movie" : "series",
                  event.name,
                  { poster: event.poster }
                ))}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedItem(toSearchResult(event.imdbId, event.type === "movie" ? "movie" : "series", event.name, { poster: event.poster })); } }}
                aria-label={`View details for ${event.name}`}
              >
                <div className="relative overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10 transition-all duration-300 group-hover:shadow-card-hover group-hover:ring-white/20" style={{ aspectRatio: "2 / 3" }}>
                  <Poster
                    src={event.poster}
                    alt={event.name}
                    className="h-full w-full"
                  />
                  {/* Bottom gradient with metadata */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-3 pb-3 pt-12">
                    {event.type === "episode" &&
                    event.season != null &&
                    event.episode != null ? (
                      <span className="inline-block rounded bg-white/10 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
                        S{event.season}:E{event.episode}
                      </span>
                    ) : event.type === "movie" ? (
                      <span className="inline-flex items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-300 backdrop-blur-sm">
                        <Film className="h-3 w-3" /> Movie
                      </span>
                    ) : null}
                  </div>
                  {/* Time ago badge */}
                  <div className="absolute top-2.5 right-2.5">
                    <span className="rounded-md bg-black/70 px-2 py-0.5 text-2xs font-medium text-slate-300 backdrop-blur-sm">
                      {timeAgo(event.watchedAt)}
                    </span>
                  </div>
                </div>
                <p className="mt-2.5 truncate text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">
                  {event.name}
                </p>
                <p className="text-2xs text-slate-500">
                  {event.type === "episode" &&
                  event.season != null &&
                  event.episode != null
                    ? `Season ${event.season}, Episode ${event.episode}`
                    : event.type === "movie"
                      ? "Movie"
                      : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Trending Movies ── */}
      <section>
        <SectionHeader title="Trending This Week">
          <div className="flex items-center gap-3">
            {!trendingLoading && trendingMovies.length > 0 && (
              <ScrollArrows
                canScrollLeft={trendingScroll.canScrollLeft}
                canScrollRight={trendingScroll.canScrollRight}
                onScroll={trendingScroll.scroll}
              />
            )}
            <Link
              to="/search"
              className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
            >
              Search &rarr;
            </Link>
          </div>
        </SectionHeader>
        {trendingLoading ? (
          <ContinueWatchingSkeleton />
        ) : trendingMovies.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 py-12 text-center">
            <TrendingUp className="mx-auto h-10 w-10 text-slate-700" />
            <p className="mt-3 text-sm text-slate-500">
              Unable to load trending content. Please try again or check your network connection.
            </p>
          </div>
        ) : (
          <div
            ref={trendingScroll.ref}
            className="flex gap-4 overflow-x-auto pb-2 scroll-smooth scrollbar-hide"
          >
            {trendingMovies.map((item) => (
              <DiscoveryCard
                key={item.id}
                item={item}
                onSelect={(i) => setSelectedItem(toSearchResult(i.id, i.type ?? "movie", i.name, { poster: i.poster, year: i.year, description: item.description, genres: i.genres, rating: i.rating }))}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Recommended For You ── */}
      {(recsLoading || recommendations.length > 0) && (
        <section>
          <SectionHeader title="Recommended For You">
            {!recsLoading && recommendations.length > 0 && (
              <ScrollArrows
                canScrollLeft={recsScroll.canScrollLeft}
                canScrollRight={recsScroll.canScrollRight}
                onScroll={recsScroll.scroll}
              />
            )}
          </SectionHeader>
          {recsLoading ? (
            <ContinueWatchingSkeleton />
          ) : (
            <div
              ref={recsScroll.ref}
              className="flex gap-4 overflow-x-auto pb-2 scroll-smooth scrollbar-hide"
            >
              {recommendations.map((item) => (
                <DiscoveryCard
                  key={item.id}
                  item={item}
                  onSelect={(i) => setSelectedItem(toSearchResult(i.id, i.type ?? "movie", i.name, { poster: i.poster, year: i.year, description: item.description, genres: i.genres, rating: i.rating }))}
                  badge={
                    <span className="inline-flex items-center gap-1 rounded-md bg-violet-600/80 px-1.5 py-0.5 text-2xs font-semibold text-white backdrop-blur-sm">
                      <Sparkles className="h-2.5 w-2.5" />
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Recommended Series For You ── */}
      {(seriesRecsLoading || seriesRecs.length > 0) && (
        <section>
          <SectionHeader title="Recommended Series For You">
            {!seriesRecsLoading && seriesRecs.length > 0 && (
              <ScrollArrows
                canScrollLeft={seriesRecsScroll.canScrollLeft}
                canScrollRight={seriesRecsScroll.canScrollRight}
                onScroll={seriesRecsScroll.scroll}
              />
            )}
          </SectionHeader>
          {seriesRecsLoading ? (
            <ContinueWatchingSkeleton />
          ) : (
            <div
              ref={seriesRecsScroll.ref}
              className="flex gap-4 overflow-x-auto pb-2 scroll-smooth scrollbar-hide"
            >
              {seriesRecs.map((item) => (
                <DiscoveryCard
                  key={item.id}
                  item={item}
                  onSelect={(i) => setSelectedItem(toSearchResult(i.id, "series", i.name, { poster: i.poster, year: i.year, description: item.description, genres: i.genres, rating: i.rating }))}
                  badge={
                    <span className="inline-flex items-center gap-1 rounded-md bg-violet-600/80 px-1.5 py-0.5 text-2xs font-semibold text-white backdrop-blur-sm">
                      <Sparkles className="h-2.5 w-2.5" />
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Detail Panel ── */}
      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          history={panelHistory}
          historyLoading={panelHistoryLoading}
          listMap={emptyListMap}
          onClose={() => setSelectedItem(null)}
          onShowToast={() => {}}
          onHistoryChange={(events) => setPanelHistory(events)}
        />
      )}

      {/* ── Upcoming Episodes ── */}
      {(calendarLoading || calendarEntries.length > 0) && (
        <section>
          <SectionHeader title="Upcoming Episodes" count={calendarEntries.length} />
          {calendarLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton h-20 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {calendarEntries.map((entry) => {
                // Parse YYYY-MM-DD as local date (not UTC)
                const [y, m, d] = entry.airDate.split("-").map(Number);
                const airDate = new Date(y, m - 1, d);
                const isToday = airDate.toDateString() === new Date().toDateString();
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const isTomorrow = airDate.toDateString() === tomorrow.toDateString();
                const dateLabel = isToday
                  ? "Today"
                  : isTomorrow
                    ? "Tomorrow"
                    : airDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

                return (
                  <div
                    key={`${entry.seriesImdbId}-s${entry.season}e${entry.episode}`}
                    className="flex items-center gap-4 rounded-xl border border-slate-800/40 bg-slate-900/30 p-3 transition-all hover:bg-slate-900/60 hover:border-slate-700/60"
                  >
                    <div className="h-16 w-11 flex-none overflow-hidden rounded-lg ring-1 ring-white/5">
                      <Poster
                        src={entry.poster ?? undefined}
                        alt={entry.seriesName}
                        className="h-full w-full"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-100">
                        {entry.seriesName}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        S{entry.season}:E{entry.episode} — {entry.episodeName}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-none">
                      <span className={`rounded-full px-2.5 py-0.5 text-2xs font-semibold ${
                        isToday
                          ? "bg-red-500/15 text-red-400"
                          : isTomorrow
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-slate-800/60 text-slate-400"
                      }`}>
                        {dateLabel}
                      </span>
                      <span className="text-2xs text-slate-600">
                        {airDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
