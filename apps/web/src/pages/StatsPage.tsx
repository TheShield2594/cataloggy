import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Award, BarChart3, Calendar, Clock, Film, Flame, Minus, Star, Trophy, TrendingDown, TrendingUp } from "lucide-react";
import { api, DetailedWatchStats, WatchStats, YearInReviewStats } from "../api";
import { TicketTile } from "../components/TicketTile";
import { buildTmdbSrcSet, POSTER_GRID_SIZES } from "../components/Poster";
import { useCachedState } from "../hooks/useCachedState";
import { formatRating, ratingLabel } from "../utils/rating";
import { PAGE_TITLE, SECTION_TITLE, KICKER } from "../components/typography";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Milestone = { label: string; threshold: number; icon: typeof Film };

const MOVIE_MILESTONES: Milestone[] = [
  { label: "10 Movies", threshold: 10, icon: Film },
  { label: "50 Movies", threshold: 50, icon: Film },
  { label: "100 Movies", threshold: 100, icon: Film },
  { label: "250 Movies", threshold: 250, icon: Film },
  { label: "500 Movies", threshold: 500, icon: Film },
];

const EPISODE_MILESTONES: Milestone[] = [
  { label: "100 Episodes", threshold: 100, icon: BarChart3 },
  { label: "500 Episodes", threshold: 500, icon: BarChart3 },
  { label: "1,000 Episodes", threshold: 1000, icon: BarChart3 },
  { label: "2,500 Episodes", threshold: 2500, icon: BarChart3 },
];

const STREAK_MILESTONES: Milestone[] = [
  { label: "3-Day Streak", threshold: 3, icon: Flame },
  { label: "7-Day Streak", threshold: 7, icon: Flame },
  { label: "30-Day Streak", threshold: 30, icon: Flame },
  { label: "100-Day Streak", threshold: 100, icon: Flame },
];

function nextMilestone(milestones: Milestone[], value: number) {
  return milestones.find((m) => value < m.threshold) ?? null;
}

export function StatsPage() {
  const [stats, setStats, statsMeta] = useCachedState<WatchStats | null>("stats:summary", null);
  const [detailed, setDetailed, detailedMeta] = useCachedState<DetailedWatchStats | null>("stats:detailed", null);
  const [loading, setLoading] = useState(!statsMeta.hadCachedValue || !detailedMeta.hadCachedValue);
  const [error, setError] = useState<string | null>(null);
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);
  const [year, setYear] = useState(() => new Date().getFullYear() - 1);
  const [yearReview, setYearReview] = useState<YearInReviewStats | null>(null);
  const [yearError, setYearError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        api.getWatchStats(),
        api.getDetailedStats(),
      ]);
      setStats(s);
      setDetailed(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    setYearError(null);
    setYearReview(null);
    api.getYearInReview(year)
      .then((data) => { if (!cancelled) setYearReview(data); })
      .catch((err) => { if (!cancelled) setYearError(err instanceof Error ? err.message : "Failed to load year in review"); });
    return () => { cancelled = true; };
  }, [year]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className={PAGE_TITLE} style={{ color: "var(--text)" }}>Watch Statistics</h1>
        <div className="mx-auto max-w-lg rounded-2xl p-8 text-center" style={{ border: "1px solid rgba(244,63,94,0.2)", background: "rgba(244,63,94,0.05)" }}>
          <AlertCircle className="mx-auto h-12 w-12 text-rose-500" />
          <p className={`mt-3 ${SECTION_TITLE} text-rose-500`}>{error}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className={PAGE_TITLE} style={{ color: "var(--text)" }}>Watch Statistics</h1>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-28 rounded-2xl" />
          ))}
        </div>
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  const maxMonthlyTotal = detailed?.monthly.length
    ? Math.max(...detailed.monthly.map((m) => m.movies + m.episodes), 1)
    : 1;

  const maxGenreCount = detailed?.genreDistribution[0]?.count ?? 1;

  const momComparison = (() => {
    if (!detailed || detailed.monthly.length < 2) return null;
    const current = detailed.monthly[detailed.monthly.length - 1];
    const previous = detailed.monthly[detailed.monthly.length - 2];
    const currentTotal = current.movies + current.episodes;
    const previousTotal = previous.movies + previous.episodes;
    const diff = currentTotal - previousTotal;
    const percent = previousTotal > 0 ? Math.round((diff / previousTotal) * 100) : null;
    return { diff, percent };
  })();

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <h1 className={PAGE_TITLE} style={{ color: "var(--text)" }}>Watch Statistics</h1>

      {/* Summary tiles */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TicketTile icon={Film} label="Movies" value={stats.totalMovies} />
          <TicketTile icon={BarChart3} label="Episodes" value={stats.totalEpisodes} />
          <TicketTile icon={Flame} label="Current Streak" value={`${detailed?.currentStreak ?? 0}d`} />
          <TicketTile icon={Trophy} label="Longest Streak" value={`${detailed?.longestStreak ?? 0}d`} />
        </div>
      )}

      {/* Achievement badges */}
      {stats && (
        <MilestoneBadges
          totalMovies={stats.totalMovies}
          totalEpisodes={stats.totalEpisodes}
          longestStreak={detailed?.longestStreak ?? 0}
        />
      )}

      {/* Monthly activity chart */}
      {detailed && detailed.monthly.length > 0 && (
        <section className="glass-panel rounded-2xl p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className={SECTION_TITLE} style={{ color: "var(--text)" }}>Monthly Activity</h2>
            {momComparison && (
              <span
                className={`flex items-center gap-1 text-xs font-medium ${
                  momComparison.diff > 0
                    ? "text-emerald-500"
                    : momComparison.diff < 0
                      ? "text-rose-500"
                      : ""
                }`}
                style={momComparison.diff === 0 ? { color: "var(--text-dim)" } : undefined}
              >
                {momComparison.diff > 0 ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : momComparison.diff < 0 ? (
                  <TrendingDown className="h-3.5 w-3.5" />
                ) : (
                  <Minus className="h-3.5 w-3.5" />
                )}
                {momComparison.diff > 0 ? "+" : ""}
                {momComparison.diff}
                {momComparison.percent !== null ? ` (${momComparison.diff > 0 ? "+" : ""}${momComparison.percent}%)` : ""} vs last month
              </span>
            )}
          </div>
          <div
            className="flex items-end gap-1.5 sm:gap-2"
            style={{ height: "180px" }}
            role="img"
            aria-label={`Monthly activity chart for ${detailed.monthly
              .map((m) => `${new Date(m.month + "-15").toLocaleDateString(undefined, { month: "long", year: "numeric" })}: ${m.movies} movies, ${m.episodes} episodes`)
              .join("; ")}`}
          >
            {detailed.monthly.map((m, idx) => {
              const total = m.movies + m.episodes;
              const height = total > 0 ? Math.max((total / maxMonthlyTotal) * 100, 4) : 2;
              const movieHeight = total > 0 ? (m.movies / total) * height : 0;
              const episodeHeight = height - movieHeight;
              const label = new Date(m.month + "-15").toLocaleDateString(undefined, { month: "short" });
              const isHovered = hoveredMonth === m.month;
              const isFirst = idx === 0;
              const isLast = idx === detailed.monthly.length - 1;
              return (
                <div
                  key={m.month}
                  className="relative flex flex-1 flex-col items-center gap-1"
                  onMouseEnter={() => setHoveredMonth(m.month)}
                  onMouseLeave={() => setHoveredMonth(null)}
                  onTouchStart={() => setHoveredMonth(m.month)}
                  onTouchEnd={() => setHoveredMonth(null)}
                  onTouchCancel={() => setHoveredMonth(null)}
                >
                  {isHovered && (
                    <div
                      className={`absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-2xs shadow-e2 ${
                        isFirst ? "left-0" : isLast ? "right-0" : "left-1/2 -translate-x-1/2"
                      }`}
                      // A normal themed surface, not --bg-2. The inverted
                      // background is near-white on the four dark themes, and
                      // the two series lines below are painted in the same
                      // light accent tints as the bars they describe — on
                      // near-white they were unreadable. On --bg-1 the swatch
                      // carries the series and the label stays --text.
                      style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}
                    >
                      <p className="font-semibold" style={{ color: "var(--text)" }}>
                        {new Date(m.month + "-15").toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                      </p>
                      <p className="flex items-center gap-1.5" style={{ color: "var(--text-dim)" }}>
                        <span className="h-2 w-2 flex-none rounded-sm bg-claw-500/70" />
                        {m.movies} movies
                      </p>
                      <p className="flex items-center gap-1.5" style={{ color: "var(--text-dim)" }}>
                        <span className="h-2 w-2 flex-none rounded-sm bg-plum-500/70" />
                        {m.episodes} episodes
                      </p>
                    </div>
                  )}
                  <span className="text-2xs tabular-nums" style={{ color: "var(--text-mute)" }}>{total || ""}</span>
                  <div className="flex w-full flex-col justify-end" style={{ height: "140px" }}>
                    {episodeHeight > 0 && (
                      <div
                        className={`w-full rounded-t bg-plum-500/70 transition-all duration-slow ${isHovered ? "bg-plum-500" : ""}`}
                        style={{ height: `${episodeHeight}%` }}
                      />
                    )}
                    {movieHeight > 0 && (
                      <div
                        className={`w-full bg-claw-500/70 transition-all duration-slow ${episodeHeight === 0 ? "rounded-t" : ""} rounded-b ${isHovered ? "bg-claw-500" : ""}`}
                        style={{ height: `${movieHeight}%` }}
                      />
                    )}
                    {total === 0 && (
                      <div
                        className="w-full rounded border border-dashed"
                        style={{ height: "4%", background: "var(--surface-strong)", borderColor: "var(--border-strong)" }}
                      />
                    )}
                  </div>
                  <span className="text-2xs" style={{ color: "var(--text-mute)" }}>{label}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs" style={{ color: "var(--text-dim)" }}>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-claw-500/70" /> Movies
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-plum-500/70" /> Episodes
            </span>
          </div>
        </section>
      )}

      {/* Genre distribution */}
      {detailed && detailed.genreDistribution.length > 0 && (
        <section className="glass-panel rounded-2xl p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
          <h2 className={`mb-4 ${SECTION_TITLE}`} style={{ color: "var(--text)" }}>Top Genres</h2>
          <div className="space-y-2.5">
            {detailed.genreDistribution.map((g) => (
              <div key={g.genre} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-sm" style={{ color: "var(--text-dim)" }}>{g.genre}</span>
                <div
                  className="flex-1 h-5 overflow-hidden rounded-full"
                  style={{ background: "var(--surface-strong)" }}
                  title={`${g.genre}: ${g.count} watched`}
                >
                  <div
                    className="h-full rounded-full bg-claw-500/80 transition-all duration-slow"
                    style={{ width: `${(g.count / maxGenreCount) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right text-sm tabular-nums" style={{ color: "var(--text-mute)" }}>{g.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top rated watched content */}
      {detailed && detailed.topRated.length > 0 && (
        <section className="glass-panel rounded-2xl p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
          <h2 className={`mb-4 flex items-center gap-2 ${SECTION_TITLE}`} style={{ color: "var(--text)" }}>
            <Star className="h-5 w-5 text-amber-400" /> Top Rated Watched
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {detailed.topRated.map((item, index) => (
              <div key={item.imdbId} className="group">
                <div
                  className="poster-frame relative overflow-hidden rounded-xl group-hover:scale-[1.03]"
                  style={{ aspectRatio: "2/3" }}
                >
                  {item.poster ? (
                    <img
                      src={item.poster}
                      srcSet={buildTmdbSrcSet(item.poster)}
                      sizes={POSTER_GRID_SIZES}
                      alt={item.name}
                      className="h-full w-full object-cover"
                      loading={index < 5 ? "eager" : "lazy"}
                      fetchPriority={index < 5 ? "high" : "low"}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center" style={{ background: "var(--surface-strong)" }}>
                      <Film className="h-8 w-8" style={{ color: "var(--text-mute)" }} />
                    </div>
                  )}
                  {item.rating != null && (
                    <div role="img" aria-label={ratingLabel(item.rating)} title={ratingLabel(item.rating)} className="absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 backdrop-blur-sm" style={{ boxShadow: "0 0 0 1.5px rgba(245,158,11,0.7)" }}>
                      <span aria-hidden="true" className="text-2xs font-bold tabular-nums text-amber-400">{formatRating(item.rating)}</span>
                    </div>
                  )}
                </div>
                <p className="mt-1.5 truncate text-sm font-medium" style={{ color: "var(--text)" }}>{item.name}</p>
                <p className="text-2xs capitalize" style={{ color: "var(--text-mute)" }}>{item.type}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Year in Review */}
      <section className="glass-panel rounded-2xl p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className={SECTION_TITLE} style={{ color: "var(--text)" }}>Year in Review</h2>
          <select
            aria-label="Year in review: year"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg px-3 py-1.5 text-sm"
            style={{ border: "1px solid var(--border)", background: "var(--surface-strong)", color: "var(--text)" }}
          >
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {yearError && <p className="text-sm text-rose-500">{yearError}</p>}

        {!yearError && yearReview && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <TicketTile icon={Film} label="Movies Watched" value={yearReview.totalMovies} />
              <TicketTile icon={BarChart3} label="Episodes Watched" value={yearReview.totalEpisodes} />
              <TicketTile icon={Clock} label="Hours Watched" value={Math.round(yearReview.totalRuntimeMinutes / 60)} />
              <TicketTile icon={Calendar} label="Busiest Month" value={yearReview.busiestMonth !== null ? MONTH_NAMES[yearReview.busiestMonth] : "—"} />
            </div>

            {yearReview.topGenres.length > 0 && (
              <div>
                <h3 className={`mb-2 ${KICKER}`} style={{ color: "var(--text-dim)" }}>Top Genres</h3>
                <div className="flex flex-wrap gap-2">
                  {yearReview.topGenres.map((g) => (
                    <span
                      key={g.genre}
                      className="rounded-full px-3 py-1 text-xs"
                      style={{ border: "1px solid var(--border)", background: "var(--surface-strong)", color: "var(--text-dim)" }}
                    >
                      {g.genre} <span style={{ color: "var(--text-mute)" }}>{g.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {yearReview.topRated.length > 0 && (
              <div>
                <h3 className={`mb-2 flex items-center gap-2 ${KICKER}`} style={{ color: "var(--text-dim)" }}>
                  <Star className="h-4 w-4 text-amber-400" /> Top Rated Picks
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                  {yearReview.topRated.map((item) => (
                    <div key={item.imdbId} className="group">
                      <div
                        className="poster-frame relative overflow-hidden rounded-xl group-hover:scale-[1.03]"
                        style={{ aspectRatio: "2/3" }}
                      >
                        {item.poster ? (
                          <img src={item.poster} alt={item.name ?? ""} className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center" style={{ background: "var(--surface-strong)" }}>
                            <Film className="h-8 w-8" style={{ color: "var(--text-mute)" }} />
                          </div>
                        )}
                        <div role="img" aria-label={ratingLabel(item.rating)} title={ratingLabel(item.rating)} className="absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 backdrop-blur-sm" style={{ boxShadow: "0 0 0 1.5px rgba(245,158,11,0.7)" }}>
                          <span aria-hidden="true" className="text-2xs font-bold tabular-nums text-amber-400">{formatRating(item.rating)}</span>
                        </div>
                      </div>
                      <p className="mt-1.5 truncate text-sm font-medium" style={{ color: "var(--text)" }}>{item.name ?? item.imdbId}</p>
                      <p className="text-2xs capitalize" style={{ color: "var(--text-mute)" }}>{item.type}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function MilestoneBadges({
  totalMovies,
  totalEpisodes,
  longestStreak,
}: {
  totalMovies: number;
  totalEpisodes: number;
  longestStreak: number;
}) {
  const groups = [
    { value: totalMovies, milestones: MOVIE_MILESTONES },
    { value: totalEpisodes, milestones: EPISODE_MILESTONES },
    { value: longestStreak, milestones: STREAK_MILESTONES },
  ];

  const earned = groups.flatMap(({ value, milestones }) =>
    milestones.filter((m) => value >= m.threshold)
  );
  const upcoming = groups
    .map(({ value, milestones }) => {
      const next = nextMilestone(milestones, value);
      return next ? { ...next, value } : null;
    })
    .filter((m): m is Milestone & { value: number } => m !== null);

  if (earned.length === 0 && upcoming.length === 0) return null;

  return (
    <section className="glass-panel rounded-2xl p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
      <h2 className={`mb-4 flex items-center gap-2 ${SECTION_TITLE}`} style={{ color: "var(--text)" }}>
        <Award className="h-5 w-5 text-amber-400" /> Achievements
      </h2>
      {earned.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {earned.map((m) => (
            <span
              key={m.label}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-amber-400"
              style={{ border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.1)" }}
            >
              <m.icon className="h-3.5 w-3.5" /> {m.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>No badges earned yet — keep watching!</p>
      )}
      {upcoming.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {upcoming.map((m) => (
            <span
              key={m.label}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ border: "1px solid var(--border)", background: "var(--surface-strong)", color: "var(--text-dim)" }}
            >
              <m.icon className="h-3.5 w-3.5" /> {m.label} ({m.value}/{m.threshold})
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
