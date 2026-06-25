import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Award, BarChart3, Film, Flame, Minus, Star, Trophy, TrendingDown, TrendingUp } from "lucide-react";
import { api, DetailedWatchStats, WatchStats } from "../api";
import { TicketTile } from "../components/TicketTile";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<WatchStats | null>(null);
  const [detailed, setDetailed] = useState<DetailedWatchStats | null>(null);
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);

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

  if (error) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl p-8 text-center" style={{ border: "1px solid rgba(244,63,94,0.2)", background: "rgba(244,63,94,0.05)" }}>
        <AlertCircle className="mx-auto h-12 w-12 text-rose-500" />
        <p className="mt-3 text-lg font-semibold text-rose-500">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h2 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Watch Statistics</h2>
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
      <h2 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Watch Statistics</h2>

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
        <section className="rounded-2xl p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Monthly Activity</h3>
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
                      className={`absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-2xs shadow-lg ${
                        isFirst ? "left-0" : isLast ? "right-0" : "left-1/2 -translate-x-1/2"
                      }`}
                      style={{ border: "1px solid var(--border)", background: "var(--bg-2)" }}
                    >
                      <p className="font-semibold" style={{ color: "var(--bg-0)" }}>
                        {new Date(m.month + "-15").toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                      </p>
                      <p className="text-claw-400">{m.movies} movies</p>
                      <p className="text-plum-500">{m.episodes} episodes</p>
                    </div>
                  )}
                  <span className="text-2xs tabular-nums" style={{ color: "var(--text-mute)" }}>{total || ""}</span>
                  <div className="flex w-full flex-col justify-end" style={{ height: "140px" }}>
                    {episodeHeight > 0 && (
                      <div
                        className={`w-full rounded-t bg-plum-500/70 transition-all duration-500 ${isHovered ? "bg-plum-500" : ""}`}
                        style={{ height: `${episodeHeight}%` }}
                      />
                    )}
                    {movieHeight > 0 && (
                      <div
                        className={`w-full bg-claw-500/70 transition-all duration-500 ${episodeHeight === 0 ? "rounded-t" : ""} rounded-b ${isHovered ? "bg-claw-500" : ""}`}
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
        <section className="rounded-2xl p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
          <h3 className="mb-4 text-lg font-semibold" style={{ color: "var(--text)" }}>Top Genres</h3>
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
                    className="h-full rounded-full bg-claw-500/80 transition-all duration-500"
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
        <section className="rounded-2xl p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold" style={{ color: "var(--text)" }}>
            <Star className="h-5 w-5 text-amber-400" /> Top Rated Watched
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {detailed.topRated.map((item, index) => (
              <div key={item.imdbId} className="group">
                <div
                  className="relative overflow-hidden rounded-xl transition-transform duration-300 group-hover:scale-[1.03]"
                  style={{ aspectRatio: "2/3", boxShadow: "inset 0 0 0 1px var(--border)" }}
                >
                  {item.poster ? (
                    <img src={item.poster} alt={item.name} className="h-full w-full object-cover" loading={index < 5 ? "eager" : "lazy"} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center" style={{ background: "var(--surface-strong)" }}>
                      <Film className="h-8 w-8" style={{ color: "var(--text-mute)" }} />
                    </div>
                  )}
                  {item.rating != null && (
                    <div className="absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 backdrop-blur-sm" style={{ boxShadow: "0 0 0 1.5px rgba(245,158,11,0.7)" }}>
                      <span className="text-2xs font-bold tabular-nums text-amber-400">{item.rating.toFixed(1)}</span>
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
    <section className="rounded-2xl p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold" style={{ color: "var(--text)" }}>
        <Award className="h-5 w-5 text-amber-400" /> Achievements
      </h3>
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
