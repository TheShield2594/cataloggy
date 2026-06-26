import { useEffect, useState, useCallback, useMemo } from "react";
import {
  AlertCircle,
  Film,
  Tv,
  ChevronRight,
  ChevronLeft,
  Check,
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
  ScrobbleSession,
  SearchResult,
  SeriesProgress,
  TrendingMeta,
  WatchEvent,
  WatchStats,
} from "../api";
import { Link } from "react-router-dom";
import { useHorizontalScroll } from "../components/carousel-utils";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { Poster } from "../components/Poster";
import { TicketTile } from "../components/TicketTile";
import { useToast } from "../hooks/useToast";
import { timeAgo } from "../utils/timeAgo";

/* ─── Collectible stat strip: a row of distinct "ticket" tiles, demoted below the fold ─── */

function StatStrip({
  stats,
  monthly,
  genres,
  currentStreak,
  longestStreak,
  loading,
}: {
  stats: WatchStats | null;
  monthly: DetailedWatchStats["monthly"];
  genres: DetailedWatchStats["genreDistribution"];
  currentStreak: number;
  longestStreak: number;
  loading: boolean;
}) {
  const last6 = monthly.slice(-6);
  const movieBars = last6.length ? last6.map((m) => m.movies) : [0, 0, 0, 0, 0, 0];
  const epBars = last6.length ? last6.map((m) => m.episodes) : [0, 0, 0, 0, 0, 0];
  const topGenre = genres[0]?.genre;

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-28 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <TicketTile icon={Flame} label="Day streak" value={currentStreak} sub={`Best: ${longestStreak}`} />
      <TicketTile icon={Film} label="Movies watched" value={stats?.totalMovies ?? 0} bars={movieBars} />
      <TicketTile icon={Tv} label="Episodes watched" value={stats?.totalEpisodes ?? 0} bars={epBars} />
      <TicketTile icon={Trophy} label="Top genre" value={topGenre ?? "—"} sub={genres[0] ? `${genres[0].count} watched` : undefined} />
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

function DiscoveryCard({ item, badge, reason, onSelect, eager }: {
  item: DiscoveryItem;
  badge?: React.ReactNode;
  reason?: string;
  onSelect?: (item: DiscoveryItem) => void;
  eager?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="flex-none group cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2"
      style={{ width: "11rem" }}
      onClick={() => onSelect?.(item)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(item); } }}
      aria-label={`View details for ${item.name}`}
    >
      <div
        className="relative aspect-poster overflow-hidden rounded-xl shadow-lg transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-card-hover"
        style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}
      >
        <Poster src={item.poster} alt={item.name} className="h-full w-full" eager={eager} />
        {item.rating != null && item.rating > 0 && (
          <div
            className="absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 backdrop-blur-sm"
            style={{ boxShadow: "0 0 0 1.5px rgba(245,158,11,0.7)" }}
          >
            <span className="text-2xs font-bold tabular-nums text-amber-400">{item.rating.toFixed(1)}</span>
          </div>
        )}
        {badge && <div className="absolute top-2 right-2">{badge}</div>}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/55 to-transparent px-3 pb-2.5 pt-10 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
          <p className="truncate text-xs font-semibold text-white">{item.name}</p>
        </div>
      </div>
      <p
        className="mt-2.5 truncate text-sm font-semibold transition-colors group-hover:text-claw-600"
        style={{ color: "var(--text)" }}
      >
        {item.name}
      </p>
      <p className="truncate text-2xs" style={{ color: "var(--text-dim)" }}>
        {item.year ?? ""}
        {item.type ? ` · ${item.type === "movie" ? "Movie" : "Series"}` : ""}
        {item.genres && item.genres.length > 0 ? ` · ${item.genres.slice(0, 2).join(", ")}` : ""}
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
        className="flex h-8 w-8 items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:cursor-default active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2"
        style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)", color: "var(--text-dim)" }}
        aria-label="Scroll left"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onScroll("right")}
        disabled={!canScrollRight}
        className="flex h-8 w-8 items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:cursor-default active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2"
        style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)", color: "var(--text-dim)" }}
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
  const [nowPlaying, setNowPlaying] = useState<ScrobbleSession[]>([]);

  const continueScroll = useHorizontalScroll();
  const recentScroll = useHorizontalScroll();
  const trendingScroll = useHorizontalScroll();
  const recsScroll = useHorizontalScroll();
  const seriesRecsScroll = useHorizontalScroll();

  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading } = useDetailPanel();
  const { showToast } = useToast();

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
    inCollection: false,
    lists: [],
  }), []);

  const emptyListMap = useMemo(() => new Map(), []);

  const load = useCallback(async () => {
    try {
      const [progressRes, historyRes, statsRes, checkinRes, nowPlayingRes] = await Promise.all([
        api.getSeriesProgress(),
        api.getWatchHistory(20),
        api.getWatchStats(),
        api.getCheckin().catch(() => ({ checkin: null })),
        api.getNowPlaying().catch(() => ({ sessions: [] })),
      ]);
      setProgress(progressRes ?? []);
      setHistory(historyRes ?? []);
      setStats(statsRes);
      setActiveCheckin(checkinRes.checkin);
      setNowPlaying(nowPlayingRes.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  const profileId = runtimeConfig.getProfileId();

  useEffect(() => {
    let mounted = true;

    setDetailedLoading(true);
    setTrendingLoading(true);
    setRecsLoading(true);
    setSeriesRecsLoading(true);
    setCalendarLoading(true);

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
        if (!mounted) return;
        setAiActive(configRes.configured);

        if (!configRes.configured) {
          setRecsLoading(false);
          setSeriesRecsLoading(false);
          return;
        }

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
      } catch (err) {
        console.error("Failed to fetch AI config:", err);
        if (mounted) { setRecsLoading(false); setSeriesRecsLoading(false); }
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
  }, [profileId]);

  useEffect(() => { void load(); }, [load, profileId]);

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
    } catch {
      // best-effort; UI simply won't show the optimistic "done" state
    } finally {
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
    <div className="space-y-8">
      {/* ── Hero: Now Watching ── */}
      {activeCheckin && (
        <section
          className="relative overflow-hidden rounded-3xl"
          style={{ minHeight: "13rem", border: "1px solid var(--border)" }}
        >
          {activeCheckin.poster && (
            <img
              src={activeCheckin.poster}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover blur-2xl scale-110 opacity-50"
            />
          )}
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(110deg, var(--bg-0) 15%, color-mix(in srgb, var(--bg-0) 35%, transparent) 60%, transparent)" }}
          />
          <div className="relative z-10 flex h-full flex-col gap-5 p-6 sm:flex-row sm:items-center">
            {activeCheckin.poster && (
              <div className="h-32 w-[5.5rem] flex-none overflow-hidden rounded-xl shadow-feature" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
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
              <p className="mt-1 truncate text-2xl font-bold" style={{ color: "var(--text)" }}>{activeCheckin.name}</p>
              {activeCheckin.season != null && activeCheckin.episode != null && (
                <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
                  S{String(activeCheckin.season).padStart(2, "0")}:E{String(activeCheckin.episode).padStart(2, "0")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-none">
              <button
                type="button"
                onClick={() => void handleCheckout(true)}
                className="flex items-center gap-1.5 rounded-xl bg-claw-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-claw-600 active:scale-[0.98] transition-all"
              >
                <Check className="h-4 w-4" /> Finished
              </button>
              <button
                type="button"
                onClick={() => void handleCheckout(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl transition-all active:scale-95"
                style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)", color: "var(--text-dim)" }}
                aria-label="Check out without logging"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Live: Plex/Jellyfin scrobble sessions ── */}
      {nowPlaying.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Playing now
          </h3>
          <div className="space-y-2">
            {nowPlaying.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-3 rounded-xl p-3"
                style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}
              >
                <div
                  className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-lg"
                  style={{ background: "var(--surface-strong)" }}
                >
                  {session.poster ? (
                    <img src={session.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : session.type === "movie" ? (
                    <Film className="h-5 w-5" style={{ color: "var(--text-mute)" }} />
                  ) : (
                    <Tv className="h-5 w-5" style={{ color: "var(--text-mute)" }} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                    {session.name ?? session.imdbId}
                    {session.type === "episode" && session.season != null && session.episode != null && (
                      <span style={{ color: "var(--text-mute)" }}>
                        {" "}S{session.season}E{session.episode}
                      </span>
                    )}
                  </p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-strong)" }}>
                    <div
                      className={`h-full rounded-full ${session.status === "paused" ? "bg-amber-400" : "bg-emerald-500"}`}
                      style={{ width: `${Math.round(session.progress)}%` }}
                    />
                  </div>
                </div>
                <span className="flex-none text-2xs font-medium capitalize" style={{ color: "var(--text-mute)" }}>
                  {session.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

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
            {progress.map((s, index) => {
              const isMarking = markingNext.has(s.imdbId);
              const isDone = markedDone.has(s.imdbId);
              const progressPct =
                typeof s.watchedEpisodes === "number" && s.totalEpisodes && s.totalEpisodes > 0
                  ? Math.min(Math.max((s.watchedEpisodes / s.totalEpisodes) * 100, 0), 100)
                  : null;
              return (
                <div key={s.imdbId} className="flex-none group" style={{ width: "13rem" }}>
                  <div
                    className="relative aspect-poster overflow-hidden rounded-2xl shadow-lg transition-all duration-300 group-hover:shadow-card-hover"
                    style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}
                  >
                    <Poster src={s.poster} alt={s.name} className="h-full w-full" eager={index < 5} />
                    <button
                      type="button"
                      className="absolute inset-0 cursor-pointer"
                      aria-label={`View details for ${s.name}`}
                      onClick={() => setSelectedItem(toSearchResult(s.imdbId, "series", s.name, { poster: s.poster }))}
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-16">
                      {progressPct !== null && (
                        <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-white/20">
                          <div className="h-full rounded-full bg-claw-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
                        </div>
                      )}
                      <p className="text-xs text-white/70">
                        S{s.lastSeason}:E{s.lastEpisode}
                        {s.totalSeasons ? ` · ${s.totalSeasons} seasons` : ""}
                      </p>
                      <button
                        type="button"
                        disabled={isMarking || isDone}
                        onClick={() => void handleMarkNext(s.imdbId)}
                        aria-label={isMarking ? "Marking" : isDone ? "Marked" : `Mark S${s.nextSeason}:E${s.nextEpisode}`}
                        className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-claw-300 ${
                          isMarking ? "bg-white/10 text-white/50" : isDone ? "bg-emerald-500/20 text-emerald-400" : "bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
                        }`}
                      >
                        {isDone ? (
                          <><Check className="h-3.5 w-3.5" /> Marked</>
                        ) : isMarking ? (
                          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "transparent" }} />
                        ) : (
                          <><ChevronRight className="h-3.5 w-3.5" /> Mark S{s.nextSeason}:E{s.nextEpisode}</>
                        )}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mt-2.5 block truncate text-sm font-semibold transition-colors text-left w-full hover:text-claw-600"
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

      {/* ── Trending Now ── */}
      <section>
        <SectionHeader title="Trending Now">
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
            {trendingMovies.map((item, index) => (
              <DiscoveryCard
                key={item.id}
                item={item}
                eager={index < 5}
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
                className="flex-none group cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2"
                style={{ width: "11rem" }}
                onClick={() => setSelectedItem(toSearchResult(event.imdbId, event.type === "movie" ? "movie" : "series", event.name, { poster: event.poster }))}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedItem(toSearchResult(event.imdbId, event.type === "movie" ? "movie" : "series", event.name, { poster: event.poster })); } }}
                aria-label={`View details for ${event.name}`}
              >
                <div
                  className="relative aspect-poster overflow-hidden rounded-xl shadow-lg transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-card-hover"
                  style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}
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
                    <span className="rounded-md bg-black/70 px-2 py-0.5 text-2xs font-medium text-white/80 backdrop-blur-sm">
                      {timeAgo(event.watchedAt)}
                    </span>
                  </div>
                </div>
                <p className="mt-2.5 truncate text-sm font-semibold transition-colors group-hover:text-claw-600" style={{ color: "var(--text)" }}>
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

      {/* ── Detail Panel ── */}
      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          history={panelHistory}
          historyLoading={panelHistoryLoading}
          listMap={emptyListMap}
          onClose={() => setSelectedItem(null)}
          onShowToast={showToast}
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
                              : ""
                        }`}
                        style={!isToday && !isTomorrow ? { background: "var(--surface-strong)", color: "var(--text-dim)" } : undefined}
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

      {/* ── Stat strip ── */}
      <section>
        <SectionHeader title="Your Stats">
          <Link to="/stats" className="text-sm font-medium text-claw-400 hover:text-claw-300 transition-colors">
            Full stats &rarr;
          </Link>
        </SectionHeader>
        <StatStrip
          stats={stats}
          monthly={monthly}
          genres={detailedStats?.genreDistribution ?? []}
          currentStreak={detailedStats?.currentStreak ?? 0}
          longestStreak={detailedStats?.longestStreak ?? 0}
          loading={loading || detailedLoading}
        />
      </section>
    </div>
  );
}
