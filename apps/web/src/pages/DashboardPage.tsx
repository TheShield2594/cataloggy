import { useEffect, useState, useCallback, useMemo } from "react";
import {
  AlertCircle,
  Film,
  Tv,
  Play,
  ChevronRight,
  ChevronLeft,
  Check,
  Star,
  TrendingUp,
  Sparkles,
  X,
  Flame,
  Trophy,
} from "lucide-react";
import {
  api,
  CalendarEntry,
  CheckIn,
  DetailedWatchStats,
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
import { timeAgo } from "../utils/timeAgo";

/* ─── Mini SVG bar chart ─── */

function MiniBarChart({ data, active = true }: { data: number[]; active?: boolean }) {
  const max = Math.max(...data, 1);
  const barW = 10;
  const gap = 4;
  const chartH = 40;
  const totalW = data.length * barW + (data.length - 1) * gap;

  return (
    <svg width={totalW} height={chartH} aria-hidden="true">
      {data.map((v, i) => {
        const barH = Math.max((v / max) * chartH, 2);
        const x = i * (barW + gap);
        const isLatest = i === data.length - 1;
        return (
          <rect
            key={i}
            x={x}
            y={chartH - barH}
            width={barW}
            height={barH}
            rx={3}
            fill={isLatest && active ? "var(--accent)" : "var(--surface-strong)"}
          />
        );
      })}
    </svg>
  );
}

/* ─── Stats overview card (3 sub-cols inside one card) ─── */

function StatColumn({
  label,
  value,
  sub,
  bars,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub: string;
  bars: number[];
  icon: React.ElementType;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-claw-400" />
        <span className="text-xs font-medium tracking-wide" style={{ color: "var(--text-mute)" }}>
          {label}
        </span>
      </div>
      <MiniBarChart data={bars} />
      <div>
        <p className="text-3xl font-bold tabular-nums leading-none" style={{ color: "var(--text)" }}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>{sub}</p>
      </div>
    </div>
  );
}

function StatsOverviewCard({
  stats,
  monthly,
  loading,
}: {
  stats: WatchStats | null;
  monthly: DetailedWatchStats["monthly"];
  loading: boolean;
}) {
  const last6 = monthly.slice(-6);
  const movieBars = last6.length ? last6.map((m) => m.movies) : [0, 0, 0, 0, 0, 0];
  const epBars = last6.length ? last6.map((m) => m.episodes) : [0, 0, 0, 0, 0, 0];
  const playBars = last6.map((m, i) => movieBars[i] + epBars[i]);

  return (
    <div
      className="rounded-2xl p-5 col-span-2 h-full"
      style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}
    >
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Watch Activity</p>
        <Link
          to="/stats"
          className="text-xs font-medium text-claw-400 hover:text-claw-300 transition-colors"
        >
          Full stats
        </Link>
      </div>

      {loading || !stats ? (
        <div className="grid grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="skeleton h-3 w-16 rounded" />
              <div className="skeleton h-10 w-full rounded" />
              <div className="skeleton h-6 w-12 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-5">
          <StatColumn
            label="Movies"
            value={stats.totalMovies}
            sub="total watched"
            bars={movieBars}
            icon={Film}
          />
          <div
            className="col-start-2"
            style={{ borderLeft: "1px solid var(--border)", paddingLeft: "1.25rem" }}
          >
            <StatColumn
              label="Episodes"
              value={stats.totalEpisodes}
              sub="total watched"
              bars={epBars}
              icon={Tv}
            />
          </div>
          <div style={{ borderLeft: "1px solid var(--border)", paddingLeft: "1.25rem" }}>
            <StatColumn
              label="Total plays"
              value={stats.totalPlays}
              sub="all time"
              bars={playBars}
              icon={Play}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Streak card ─── */

function StreakCard({
  current,
  longest,
  loading,
}: {
  current: number;
  longest: number;
  loading: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col justify-between row-span-2"
      style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}
    >
      <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Streaks</p>

      {loading ? (
        <div className="flex-1 flex flex-col gap-4 mt-5">
          <div className="skeleton h-12 w-20 rounded" />
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-8 w-16 rounded mt-4" />
          <div className="skeleton h-3 w-20 rounded" />
        </div>
      ) : (
        <div className="flex flex-col gap-5 mt-3">
          <div>
            <div className="flex items-end gap-2">
              <Flame className="h-5 w-5 text-claw-400 mb-0.5" />
              <span className="text-4xl font-bold tabular-nums leading-none" style={{ color: "var(--text)" }}>
                {current}
              </span>
            </div>
            <p className="mt-1.5 text-xs" style={{ color: "var(--text-dim)" }}>
              day streak
            </p>
          </div>

          <div
            className="pt-5"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <div className="flex items-end gap-2">
              <Trophy className="h-4 w-4 text-ink-400 mb-0.5" />
              <span className="text-2xl font-bold tabular-nums leading-none" style={{ color: "var(--text-dim)" }}>
                {longest}
              </span>
            </div>
            <p className="mt-1.5 text-xs" style={{ color: "var(--text-mute)" }}>
              longest streak
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── This month card ─── */

function ThisMonthCard({
  monthly,
  loading,
}: {
  monthly: DetailedWatchStats["monthly"];
  loading: boolean;
}) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const current = monthly.find((m) => m.month === monthKey);
  const prevIdx = monthly.findIndex((m) => m.month === monthKey) - 1;
  const prev = prevIdx >= 0 ? monthly[prevIdx] : null;

  const monthName = now.toLocaleDateString(undefined, { month: "long" });

  const movieDelta = current && prev ? current.movies - prev.movies : null;
  const epDelta = current && prev ? current.episodes - prev.episodes : null;

  return (
    <div
      className="rounded-2xl p-5"
      style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>This Month</p>
        <span className="text-xs" style={{ color: "var(--text-mute)" }}>{monthName}</span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          <div className="skeleton h-8 w-16 rounded" />
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-8 w-16 rounded" />
          <div className="skeleton h-3 w-24 rounded" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums leading-none" style={{ color: "var(--text)" }}>
                {current?.movies ?? 0}
              </span>
              {movieDelta !== null && (
                <span
                  className="text-xs font-medium tabular-nums"
                  className={movieDelta >= 0 ? "text-emerald-500" : "text-rose-500"}
                >
                  {movieDelta >= 0 ? "+" : ""}{movieDelta}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>movies</p>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums leading-none" style={{ color: "var(--text)" }}>
                {current?.episodes ?? 0}
              </span>
              {epDelta !== null && (
                <span
                  className="text-xs font-medium tabular-nums"
                  className={epDelta >= 0 ? "text-emerald-500" : "text-rose-500"}
                >
                  {epDelta >= 0 ? "+" : ""}{epDelta}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>episodes</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Top genres card ─── */

function TopGenresCard({
  genres,
  loading,
}: {
  genres: DetailedWatchStats["genreDistribution"];
  loading: boolean;
}) {
  const top = genres.slice(0, 5);
  const max = top[0]?.count ?? 1;

  return (
    <div
      className="rounded-2xl p-5"
      style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}
    >
      <p className="text-sm font-semibold mb-4" style={{ color: "var(--text)" }}>Top Genres</p>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton h-3 w-20 rounded" />
              <div className="skeleton h-2 rounded flex-1" />
              <div className="skeleton h-3 w-8 rounded" />
            </div>
          ))}
        </div>
      ) : top.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-mute)" }}>No genre data yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {top.map((g, i) => {
            const pct = (g.count / max) * 100;
            return (
              <div key={g.genre} className="flex items-center gap-3">
                <span
                  className="w-20 truncate text-xs text-right"
                  style={{ color: i === 0 ? "var(--text)" : "var(--text-dim)" }}
                >
                  {g.genre}
                </span>
                <div
                  className="flex-1 h-1.5 rounded-full overflow-hidden"
                  style={{ background: "var(--surface)" }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      background: i === 0 ? "var(--accent)" : "var(--border-strong)",
                    }}
                  />
                </div>
                <span className="w-8 text-right text-xs tabular-nums" style={{ color: "var(--text-mute)" }}>
                  {g.count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Skeleton placeholders ─── */

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

  useEffect(() => { setLoadFailed(false); }, [src]);

  if (!src || loadFailed) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br ${getGradient(alt)} ${className}`}>
        <span className="text-xl font-bold text-white/60 select-none">
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

/* ─── Discovery Card ─── */

type DiscoveryItem = {
  id: string;
  name: string;
  poster?: string;
  rating?: number;
  genres?: string[];
  year?: number;
  type?: string;
};

function DiscoveryCard({ item, badge, reason, onSelect }: {
  item: DiscoveryItem;
  badge?: React.ReactNode;
  reason?: string;
  onSelect?: (item: DiscoveryItem) => void;
}) {
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
      <div
        className="relative overflow-hidden rounded-xl shadow-lg transition-all duration-300 group-hover:shadow-card-hover"
        style={{ aspectRatio: "2 / 3", boxShadow: "inset 0 0 0 1px var(--border)" }}
      >
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
                <span
                  key={g}
                  className="rounded px-1.5 py-0.5 text-2xs backdrop-blur-sm"
                  style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}
                >
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <p
        className="mt-2.5 truncate text-sm font-semibold transition-colors group-hover:text-cream-100"
        style={{ color: "var(--text)" }}
      >
        {item.name}
      </p>
      <p className="text-2xs" style={{ color: "var(--text-dim)" }}>
        {item.year ?? ""}{item.type ? ` ${item.type === "movie" ? "Movie" : "Series"}` : ""}
      </p>
      {reason && (
        <p className="mt-0.5 truncate text-2xs italic" style={{ color: "var(--text-dim)" }} title={reason}>
          {reason}
        </p>
      )}
    </div>
  );
}

/* ─── Scroll arrows ─── */

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
        className="flex h-8 w-8 items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:cursor-default active:scale-95"
        style={{ border: "1px solid var(--border-strong)", background: "var(--bg-2)", color: "var(--text-dim)" }}
        aria-label="Scroll left"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onScroll("right")}
        disabled={!canScrollRight}
        className="flex h-8 w-8 items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:cursor-default active:scale-95"
        style={{ border: "1px solid var(--border-strong)", background: "var(--bg-2)", color: "var(--text-dim)" }}
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
        <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>{title}</h2>
        {count !== undefined && count > 0 && (
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums"
            style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}
          >
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
  const [detailedStats, setDetailedStats] = useState<DetailedWatchStats | null>(null);
  const [detailedLoading, setDetailedLoading] = useState(true);

  const [trendingMovies, setTrendingMovies] = useState<TrendingMeta[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<TrendingMeta[]>([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [seriesRecs, setSeriesRecs] = useState<TrendingMeta[]>([]);
  const [seriesRecsLoading, setSeriesRecsLoading] = useState(true);
  const [aiActive, setAiActive] = useState(false);
  const [movieReasons, setMovieReasons] = useState<Record<string, string>>({});
  const [seriesReasons, setSeriesReasons] = useState<Record<string, string>>({});
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
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await api.getDetailedStats();
        if (mounted) setDetailedStats(res);
      } catch (err) { console.error("Failed to fetch detailed stats:", err); } finally {
        if (mounted) setDetailedLoading(false);
      }
    })();
    void (async () => {
      try {
        const res = await api.getTrending("movie", "week");
        if (mounted) setTrendingMovies(res.metas ?? []);
      } catch (err) { console.error("Failed to fetch trending:", err); } finally {
        if (mounted) setTrendingLoading(false);
      }
    })();
    void (async () => {
      try {
        const configRes = await api.getAiConfig();
        if (mounted) setAiActive(configRes.configured);
      } catch (err) { console.error("Failed to fetch AI config:", err); }
    })();
    void (async () => {
      try {
        const res = await api.getAiRecommendations("movie", 20);
        if (mounted) {
          setRecommendations(res.metas ?? []);
          setMovieReasons(res.reasons ?? {});
        }
      } catch (err) { console.error("Failed to fetch movie recommendations:", err); } finally {
        if (mounted) setRecsLoading(false);
      }
    })();
    void (async () => {
      try {
        const res = await api.getAiRecommendations("series", 20);
        if (mounted) {
          setSeriesRecs(res.metas ?? []);
          setSeriesReasons(res.reasons ?? {});
        }
      } catch (err) { console.error("Failed to fetch series recommendations:", err); } finally {
        if (mounted) setSeriesRecsLoading(false);
      }
    })();
    void (async () => {
      try {
        const res = await api.getCalendar(14);
        if (mounted) setCalendarEntries(res.calendar ?? []);
      } catch (err) { console.error("Failed to fetch calendar:", err); } finally {
        if (mounted) setCalendarLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => { void load(); }, [load]);

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
  }, [loading, trendingLoading, recsLoading, seriesRecsLoading, progress.length, history.length,
    continueScroll.checkScroll, recentScroll.checkScroll, trendingScroll.checkScroll,
    recsScroll.checkScroll, seriesRecsScroll.checkScroll]);

  const handleMarkNext = async (imdbId: string) => {
    setMarkingNext((prev) => new Set(prev).add(imdbId));
    try {
      await api.markNextEpisodeWatched(imdbId);
      setMarkedDone((prev) => new Set(prev).add(imdbId));
      setTimeout(() => {
        setMarkedDone((prev) => { const next = new Set(prev); next.delete(imdbId); return next; });
        void load();
      }, 1200);
    } catch { } finally {
      setMarkingNext((prev) => { const next = new Set(prev); next.delete(imdbId); return next; });
    }
  };

  if (error) {
    return (
      <div
        className="mx-auto max-w-lg space-y-4 rounded-2xl border border-claw-400/20 bg-claw-400/5 p-8 text-center"
      >
        <AlertCircle className="mx-auto h-12 w-12 text-claw-400" />
        <p className="text-xl font-semibold text-claw-300">Unable to connect to the API</p>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>{error}</p>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          API base: <span className="font-mono text-claw-400">{runtimeConfig.getApiBase()}</span>
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-claw-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-claw-600 transition-colors active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400"
          >
            Reload
          </button>
          <Link
            to="/settings"
            className="rounded-lg px-5 py-2.5 text-sm font-medium transition-colors focus:outline-none"
            style={{ border: "1px solid var(--border-strong)", color: "var(--text-dim)" }}
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

  const monthly = detailedStats?.monthly ?? [];

  return (
    <div className="space-y-10">
      {/* ── Now Watching Banner ── */}
      {activeCheckin && (
        <div
          className="flex items-center gap-4 rounded-2xl border border-claw-400/25 bg-claw-400/6 px-5 py-4"
        >
          {activeCheckin.poster && (
            <div className="h-14 w-10 flex-none overflow-hidden rounded-lg" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
              <img src={activeCheckin.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-claw-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-claw-500" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-claw-400">Now Watching</span>
            </div>
            <p className="mt-0.5 truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{activeCheckin.name}</p>
            {activeCheckin.season != null && activeCheckin.episode != null && (
              <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                S{String(activeCheckin.season).padStart(2, "0")}:E{String(activeCheckin.episode).padStart(2, "0")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-none">
            <button
              type="button"
              onClick={() => void handleCheckout(true)}
              className="flex items-center gap-1.5 rounded-xl bg-claw-500 px-3 py-2 text-xs font-semibold text-white hover:bg-claw-600 active:scale-[0.98] transition-all"
            >
              <Check className="h-3.5 w-3.5" /> Finished
            </button>
            <button
              type="button"
              onClick={() => void handleCheckout(false)}
              className="flex h-8 w-8 items-center justify-center rounded-xl transition-all active:scale-95"
              style={{ border: "1px solid var(--border-strong)", background: "var(--bg-2)", color: "var(--text-dim)" }}
              aria-label="Check out without logging"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Stats bento grid ── */}
      <section>
        {/* Desktop: 3-col asymmetric bento. Mobile: 2-col stacked. */}
        <div className="hidden lg:grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 220px", gridTemplateRows: "auto auto" }}>
          <StatsOverviewCard stats={stats} monthly={monthly} loading={loading || detailedLoading} />
          <StreakCard current={detailedStats?.currentStreak ?? 0} longest={detailedStats?.longestStreak ?? 0} loading={detailedLoading} />
          <ThisMonthCard monthly={monthly} loading={detailedLoading} />
          <TopGenresCard genres={detailedStats?.genreDistribution ?? []} loading={detailedLoading} />
        </div>

        {/* Mobile/tablet fallback: 2-col grid, no row-span */}
        <div className="grid grid-cols-2 gap-3 lg:hidden">
          <div className="col-span-2">
            <StatsOverviewCard stats={stats} monthly={monthly} loading={loading || detailedLoading} />
          </div>
          <StreakCard current={detailedStats?.currentStreak ?? 0} longest={detailedStats?.longestStreak ?? 0} loading={detailedLoading} />
          <ThisMonthCard monthly={monthly} loading={detailedLoading} />
          <div className="col-span-2">
            <TopGenresCard genres={detailedStats?.genreDistribution ?? []} loading={detailedLoading} />
          </div>
        </div>
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
          <div className="rounded-2xl py-12 text-center" style={{ border: "1px dashed var(--border-strong)" }}>
            <Tv className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
            <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>
              No series in progress. Start watching something!
            </p>
          </div>
        ) : (
          <div ref={continueScroll.ref} className="flex gap-4 overflow-x-auto pb-2 scroll-smooth scrollbar-hide">
            {progress.map((s) => {
              const isMarking = markingNext.has(s.imdbId);
              const isDone = markedDone.has(s.imdbId);
              const progressPct =
                typeof s.watchedEpisodes === "number" && s.totalEpisodes && s.totalEpisodes > 0
                  ? Math.min(Math.max((s.watchedEpisodes / s.totalEpisodes) * 100, 0), 100)
                  : null;
              return (
                <div key={s.imdbId} className="flex-none group" style={{ width: "11rem" }}>
                  <div
                    className="relative overflow-hidden rounded-xl shadow-lg transition-all duration-300 group-hover:shadow-card-hover"
                    style={{ aspectRatio: "2 / 3", boxShadow: "inset 0 0 0 1px var(--border)" }}
                  >
                    <Poster src={s.poster} alt={s.name} className="h-full w-full" />
                    <button
                      type="button"
                      className="absolute inset-0 cursor-pointer"
                      aria-label={`View details for ${s.name}`}
                      onClick={() => setSelectedItem(toSearchResult(s.imdbId, "series", s.name, { poster: s.poster }))}
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-16">
                      {progressPct !== null && (
                        <div className="mb-2 h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-strong)" }}>
                          <div className="h-full rounded-full bg-claw-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
                        </div>
                      )}
                      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                        S{s.lastSeason}:E{s.lastEpisode}
                        {s.totalSeasons ? ` · ${s.totalSeasons} seasons` : ""}
                      </p>
                      <button
                        type="button"
                        disabled={isMarking || isDone}
                        onClick={() => void handleMarkNext(s.imdbId)}
                        aria-label={isMarking ? "Marking" : isDone ? "Marked" : `Mark S${s.nextSeason}:E${s.nextEpisode}`}
                        className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all active:scale-[0.98] ${
                          isDone ? "bg-emerald-500/20 text-emerald-400" : "text-white backdrop-blur-sm"
                        }`}
                        style={isMarking ? { background: "var(--bg-2)", color: "var(--text-mute)" } : isDone ? {} : { background: "var(--surface)" }}
                      >
                        {isDone ? (
                          <><Check className="h-3.5 w-3.5" /> Marked</>
                        ) : isMarking ? (
                          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-400 border-t-transparent" />
                        ) : (
                          <><ChevronRight className="h-3.5 w-3.5" /> Mark S{s.nextSeason}:E{s.nextEpisode}</>
                        )}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mt-2.5 block truncate text-sm font-semibold transition-colors text-left w-full hover:text-cream-100"
                    style={{ color: "var(--text)" }}
                    onClick={() => setSelectedItem(toSearchResult(s.imdbId, "series", s.name, { poster: s.poster }))}
                  >
                    {s.name}
                  </button>
                  {progressPct !== null && (
                    <p className="text-2xs" style={{ color: "var(--text-dim)" }}>
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
          <div className="rounded-2xl py-12 text-center" style={{ border: "1px dashed var(--border-strong)" }}>
            <Film className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
            <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>No watch history yet.</p>
          </div>
        ) : (
          <div ref={recentScroll.ref} className="flex gap-4 overflow-x-auto pb-2 scroll-smooth scrollbar-hide">
            {history.map((event) => (
              <div
                key={event.id}
                role="button"
                tabIndex={0}
                className="flex-none group cursor-pointer"
                style={{ width: "11rem" }}
                onClick={() => setSelectedItem(toSearchResult(event.imdbId, event.type === "movie" ? "movie" : "series", event.name, { poster: event.poster }))}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedItem(toSearchResult(event.imdbId, event.type === "movie" ? "movie" : "series", event.name, { poster: event.poster })); } }}
                aria-label={`View details for ${event.name}`}
              >
                <div
                  className="relative overflow-hidden rounded-xl shadow-lg transition-all duration-300 group-hover:shadow-card-hover"
                  style={{ aspectRatio: "2 / 3", boxShadow: "inset 0 0 0 1px var(--border)" }}
                >
                  <Poster src={event.poster} alt={event.name} className="h-full w-full" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-3 pb-3 pt-12">
                    {event.type === "episode" && event.season != null && event.episode != null ? (
                      <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm" style={{ background: "var(--surface-strong)" }}>
                        S{event.season}:E{event.episode}
                      </span>
                    ) : event.type === "movie" ? (
                      <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-claw-300 backdrop-blur-sm bg-claw-500/20">
                        <Film className="h-3 w-3" /> Movie
                      </span>
                    ) : null}
                  </div>
                  <div className="absolute top-2.5 right-2.5">
                    <span className="rounded-md bg-black/70 px-2 py-0.5 text-2xs font-medium backdrop-blur-sm" style={{ color: "var(--text-dim)" }}>
                      {timeAgo(event.watchedAt)}
                    </span>
                  </div>
                </div>
                <p className="mt-2.5 truncate text-sm font-semibold transition-colors group-hover:text-cream-100" style={{ color: "var(--text)" }}>
                  {event.name}
                </p>
                <p className="text-2xs" style={{ color: "var(--text-dim)" }}>
                  {event.type === "episode" && event.season != null && event.episode != null
                    ? `Season ${event.season}, Episode ${event.episode}`
                    : event.type === "movie" ? "Movie" : ""}
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
            <Link to="/search" className="text-sm font-medium text-claw-400 hover:text-claw-300 transition-colors">
              Search &rarr;
            </Link>
          </div>
        </SectionHeader>
        {trendingLoading ? (
          <ContinueWatchingSkeleton />
        ) : trendingMovies.length === 0 ? (
          <div className="rounded-2xl py-12 text-center" style={{ border: "1px dashed var(--border-strong)" }}>
            <TrendingUp className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
            <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>
              Unable to load trending content.
            </p>
          </div>
        ) : (
          <div ref={trendingScroll.ref} className="flex gap-4 overflow-x-auto pb-2 scroll-smooth scrollbar-hide">
            {trendingMovies.map((item) => (
              <DiscoveryCard
                key={item.id}
                item={item}
                onSelect={(i) => setSelectedItem(toSearchResult(i.id, (i.type ?? "movie") as "movie" | "series", i.name, { poster: i.poster, year: i.year, description: item.description, genres: i.genres, rating: i.rating }))}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Recommended Movies ── */}
      {(recsLoading || recommendations.length > 0) && (
        <section>
          <SectionHeader title={aiActive ? "AI Picks - Movies" : "Recommended For You"}>
            {!recsLoading && recommendations.length > 0 && (
              <ScrollArrows
                canScrollLeft={recsScroll.canScrollLeft}
                canScrollRight={recsScroll.canScrollRight}
                onScroll={recsScroll.scroll}
              />
            )}
          </SectionHeader>
          {recsLoading ? (
            aiActive
              ? <p className="text-sm italic" style={{ color: "var(--text-dim)" }}>Generating AI recommendations...</p>
              : <ContinueWatchingSkeleton />
          ) : (
            <div ref={recsScroll.ref} className="flex gap-4 overflow-x-auto pb-2 scroll-smooth scrollbar-hide">
              {recommendations.map((item) => (
                <DiscoveryCard
                  key={item.id}
                  item={item}
                  reason={movieReasons[item.id]}
                  onSelect={(i) => setSelectedItem(toSearchResult(i.id, (i.type ?? "movie") as "movie" | "series", i.name, { poster: i.poster, year: i.year, description: item.description, genres: i.genres, rating: i.rating }))}
                  badge={
                    <span className="inline-flex items-center gap-1 rounded-md bg-plum-500/80 px-1.5 py-0.5 text-2xs font-semibold text-white backdrop-blur-sm">
                      <Sparkles className="h-2.5 w-2.5" />
                      {aiActive && <span>AI</span>}
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Recommended Series ── */}
      {(seriesRecsLoading || seriesRecs.length > 0) && (
        <section>
          <SectionHeader title={aiActive ? "AI Picks - Series" : "Recommended Series For You"}>
            {!seriesRecsLoading && seriesRecs.length > 0 && (
              <ScrollArrows
                canScrollLeft={seriesRecsScroll.canScrollLeft}
                canScrollRight={seriesRecsScroll.canScrollRight}
                onScroll={seriesRecsScroll.scroll}
              />
            )}
          </SectionHeader>
          {seriesRecsLoading ? (
            aiActive
              ? <p className="text-sm italic" style={{ color: "var(--text-dim)" }}>Generating AI recommendations...</p>
              : <ContinueWatchingSkeleton />
          ) : (
            <div ref={seriesRecsScroll.ref} className="flex gap-4 overflow-x-auto pb-2 scroll-smooth scrollbar-hide">
              {seriesRecs.map((item) => (
                <DiscoveryCard
                  key={item.id}
                  item={item}
                  reason={seriesReasons[item.id]}
                  onSelect={(i) => setSelectedItem(toSearchResult(i.id, "series", i.name, { poster: i.poster, year: i.year, description: item.description, genres: i.genres, rating: i.rating }))}
                  badge={
                    <span className="inline-flex items-center gap-1 rounded-md bg-plum-500/80 px-1.5 py-0.5 text-2xs font-semibold text-white backdrop-blur-sm">
                      <Sparkles className="h-2.5 w-2.5" />
                      {aiActive && <span>AI</span>}
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
                const [y, m, d] = entry.airDate.split("-").map(Number);
                const airDate = new Date(y, m - 1, d);
                const isToday = airDate.toDateString() === new Date().toDateString();
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const isTomorrow = airDate.toDateString() === tomorrow.toDateString();
                const dateLabel = isToday ? "Today"
                  : isTomorrow ? "Tomorrow"
                  : airDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

                return (
                  <div
                    key={`${entry.seriesImdbId}-s${entry.season}e${entry.episode}`}
                    className="flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 transition-all hover:border-[var(--border-strong)] hover:bg-[var(--surface-strong)]"
                  >
                    <div className="h-16 w-11 flex-none overflow-hidden rounded-lg" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
                      <Poster src={entry.poster ?? undefined} alt={entry.seriesName} className="h-full w-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>
                        {entry.seriesName}
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-dim)" }}>
                        S{entry.season}:E{entry.episode} - {entry.episodeName}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-none">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-2xs font-semibold ${
                          isToday
                            ? "bg-claw-500/15 text-claw-400"
                            : isTomorrow
                              ? "bg-amber-500/15 text-amber-400"
                              : "text-ink-400"
                        }`}
                        style={!isToday && !isTomorrow ? { background: "var(--surface-strong)" } : undefined}
                      >
                        {dateLabel}
                      </span>
                      <span className="text-2xs tabular-nums" style={{ color: "var(--text-mute)" }}>
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
