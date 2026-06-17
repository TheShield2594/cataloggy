import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Award, BarChart3, Film, Flame, Minus, Star, Trophy, TrendingDown, TrendingUp } from "lucide-react";
import { api, DetailedWatchStats, WatchStats } from "../api";

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
      <div className="mx-auto max-w-lg rounded-2xl border border-rose-500/20 bg-rose-500/5 p-8 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-rose-400" />
        <p className="mt-3 text-lg font-semibold text-rose-300">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h2 className="text-2xl font-bold">Watch Statistics</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-ink-800/60 bg-ink-900/40 p-5">
              <div className="skeleton h-8 w-16 rounded-lg mb-2" />
              <div className="skeleton h-4 w-24 rounded" />
            </div>
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
      <h2 className="text-2xl font-bold">Watch Statistics</h2>

      {/* Summary cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Movies" value={stats.totalMovies} icon={Film} color="red" />
          <StatCard label="Episodes" value={stats.totalEpisodes} icon={BarChart3} color="violet" />
          <StatCard label="Current Streak" value={detailed?.currentStreak ?? 0} icon={Flame} color="amber" suffix="d" />
          <StatCard label="Longest Streak" value={detailed?.longestStreak ?? 0} icon={Trophy} color="emerald" suffix="d" />
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
        <section className="rounded-2xl border border-ink-800/60 bg-ink-900/40 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Monthly Activity</h3>
            {momComparison && (
              <span
                className={`flex items-center gap-1 text-xs font-medium ${
                  momComparison.diff > 0
                    ? "text-emerald-400"
                    : momComparison.diff < 0
                      ? "text-rose-400"
                      : "text-ink-400"
                }`}
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
          <div className="flex items-end gap-1.5 sm:gap-2" style={{ height: "180px" }}>
            {detailed.monthly.map((m) => {
              const total = m.movies + m.episodes;
              const height = total > 0 ? Math.max((total / maxMonthlyTotal) * 100, 4) : 2;
              const movieHeight = total > 0 ? (m.movies / total) * height : 0;
              const episodeHeight = height - movieHeight;
              const label = new Date(m.month + "-15").toLocaleDateString(undefined, { month: "short" });
              const isHovered = hoveredMonth === m.month;
              return (
                <div
                  key={m.month}
                  className="relative flex flex-1 flex-col items-center gap-1"
                  onMouseEnter={() => setHoveredMonth(m.month)}
                  onMouseLeave={() => setHoveredMonth(null)}
                  onTouchStart={() => setHoveredMonth(m.month)}
                >
                  {isHovered && (
                    <div className="absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-2xs shadow-lg">
                      <p className="font-semibold text-ink-200">
                        {new Date(m.month + "-15").toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                      </p>
                      <p className="text-claw-400">{m.movies} movies</p>
                      <p className="text-plum-400">{m.episodes} episodes</p>
                    </div>
                  )}
                  <span className="text-2xs text-ink-400 tabular-nums">{total || ""}</span>
                  <div className="flex w-full flex-col justify-end" style={{ height: "140px" }}>
                    {episodeHeight > 0 && (
                      <div
                        className={`w-full rounded-t bg-plum-500/70 transition-all duration-500 ${isHovered ? "bg-plum-400" : ""}`}
                        style={{ height: `${episodeHeight}%` }}
                      />
                    )}
                    {movieHeight > 0 && (
                      <div
                        className={`w-full bg-claw-500/70 transition-all duration-500 ${episodeHeight === 0 ? "rounded-t" : ""} rounded-b ${isHovered ? "bg-claw-400" : ""}`}
                        style={{ height: `${movieHeight}%` }}
                      />
                    )}
                    {total === 0 && (
                      <div className="w-full rounded bg-ink-800/60" style={{ height: "2%" }} />
                    )}
                  </div>
                  <span className="text-2xs text-ink-400">{label}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-ink-400">
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
        <section className="rounded-2xl border border-ink-800/60 bg-ink-900/40 p-5">
          <h3 className="mb-4 text-lg font-semibold">Top Genres</h3>
          <div className="space-y-2.5">
            {detailed.genreDistribution.map((g) => (
              <div key={g.genre} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-sm text-ink-300">{g.genre}</span>
                <div
                  className="flex-1 h-5 rounded-full bg-ink-800/60 overflow-hidden"
                  title={`${g.genre}: ${g.count} watched`}
                >
                  <div
                    className="h-full rounded-full bg-claw-500/80 transition-all duration-500"
                    style={{ width: `${(g.count / maxGenreCount) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right text-sm tabular-nums text-ink-400">{g.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top rated watched content */}
      {detailed && detailed.topRated.length > 0 && (
        <section className="rounded-2xl border border-ink-800/60 bg-ink-900/40 p-5">
          <h3 className="mb-4 text-lg font-semibold flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-400" /> Top Rated Watched
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {detailed.topRated.map((item) => (
              <div key={item.imdbId} className="group">
                <div className="relative overflow-hidden rounded-xl ring-1 ring-white/10" style={{ aspectRatio: "2/3" }}>
                  {item.poster ? (
                    <img src={item.poster} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-800 to-ink-900">
                      <Film className="h-8 w-8 text-ink-600" />
                    </div>
                  )}
                  {item.rating != null && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-bold text-amber-400 backdrop-blur-sm">
                      <Star className="h-3 w-3 fill-amber-400" />
                      {item.rating.toFixed(1)}
                    </div>
                  )}
                </div>
                <p className="mt-1.5 truncate text-sm font-medium text-ink-200">{item.name}</p>
                <p className="text-2xs text-ink-400 capitalize">{item.type}</p>
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
    <section className="rounded-2xl border border-ink-800/60 bg-ink-900/40 p-5">
      <h3 className="mb-4 text-lg font-semibold flex items-center gap-2">
        <Award className="h-5 w-5 text-amber-400" /> Achievements
      </h3>
      {earned.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {earned.map((m) => (
            <span
              key={m.label}
              className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300"
            >
              <m.icon className="h-3.5 w-3.5" /> {m.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-400">No badges earned yet — keep watching!</p>
      )}
      {upcoming.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {upcoming.map((m) => (
            <span
              key={m.label}
              className="flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-800/40 px-3 py-1.5 text-xs font-medium text-ink-400"
            >
              <m.icon className="h-3.5 w-3.5" /> {m.label} ({m.value}/{m.threshold})
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  suffix = "",
}: {
  label: string;
  value: number;
  icon: typeof Film;
  color: "red" | "violet" | "amber" | "emerald";
  suffix?: string;
}) {
  const colorMap = {
    red: { bg: "from-claw-500/10", border: "border-claw-500/20", icon: "text-claw-500" },
    violet: { bg: "from-plum-500/10", border: "border-plum-500/20", icon: "text-plum-500" },
    amber: { bg: "from-amber-500/10", border: "border-amber-500/20", icon: "text-amber-400" },
    emerald: { bg: "from-emerald-500/10", border: "border-emerald-500/20", icon: "text-emerald-400" },
  };
  const c = colorMap[color];

  return (
    <div className={`rounded-2xl border ${c.border} bg-gradient-to-br ${c.bg} bg-ink-900/40 p-5`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-ink-800/80 ${c.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <span className="text-2xl font-bold text-white tabular-nums">
            {value.toLocaleString()}{suffix}
          </span>
          <p className="text-xs text-ink-400 font-medium">{label}</p>
        </div>
      </div>
    </div>
  );
}
