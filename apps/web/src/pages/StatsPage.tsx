import { useCallback, useEffect, useState } from "react";
import { AlertCircle, BarChart3, Film, Flame, Star, Trophy } from "lucide-react";
import { api, DetailedWatchStats, WatchStats } from "../api";

export function StatsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<WatchStats | null>(null);
  const [detailed, setDetailed] = useState<DetailedWatchStats | null>(null);

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
            <div key={i} className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-5">
              <div className="skeleton h-8 w-16 rounded-lg mb-2" />
              <div className="skeleton h-4 w-24 rounded" />
            </div>
          ))}
        </div>
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  const maxMonthlyTotal = detailed?.monthly?.length
    ? Math.max(...detailed.monthly.map((m) => m.movies + m.episodes), 1)
    : 1;

  const maxGenreCount = detailed?.genreDistribution[0]?.count ?? 1;

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

      {/* Monthly activity chart */}
      {detailed && detailed.monthly.length > 0 && (
        <section className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-5">
          <h3 className="mb-4 text-lg font-semibold">Monthly Activity</h3>
          <div className="flex items-end gap-1.5 sm:gap-2" style={{ height: "180px" }}>
            {detailed.monthly.map((m) => {
              const total = m.movies + m.episodes;
              const height = total > 0 ? Math.max((total / maxMonthlyTotal) * 100, 4) : 2;
              const movieHeight = total > 0 ? (m.movies / total) * height : 0;
              const episodeHeight = height - movieHeight;
              const label = new Date(m.month + "-15").toLocaleDateString(undefined, { month: "short" });
              return (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-2xs text-slate-500 tabular-nums">{total || ""}</span>
                  <div className="flex w-full flex-col justify-end" style={{ height: "140px" }}>
                    {episodeHeight > 0 && (
                      <div
                        className="w-full rounded-t bg-violet-500/70 transition-all duration-500"
                        style={{ height: `${episodeHeight}%` }}
                        title={`${m.episodes} episodes`}
                      />
                    )}
                    {movieHeight > 0 && (
                      <div
                        className={`w-full bg-red-500/70 transition-all duration-500 ${episodeHeight === 0 ? "rounded-t" : ""} rounded-b`}
                        style={{ height: `${movieHeight}%` }}
                        title={`${m.movies} movies`}
                      />
                    )}
                    {total === 0 && (
                      <div className="w-full rounded bg-slate-800/60" style={{ height: "2%" }} />
                    )}
                  </div>
                  <span className="text-2xs text-slate-500">{label}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-red-500/70" /> Movies
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-violet-500/70" /> Episodes
            </span>
          </div>
        </section>
      )}

      {/* Genre distribution */}
      {detailed && detailed.genreDistribution.length > 0 && (
        <section className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-5">
          <h3 className="mb-4 text-lg font-semibold">Top Genres</h3>
          <div className="space-y-2.5">
            {detailed.genreDistribution.map((g) => (
              <div key={g.genre} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-sm text-slate-300">{g.genre}</span>
                <div className="flex-1 h-5 rounded-full bg-slate-800/60 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-red-500/80 to-red-400/60 transition-all duration-500"
                    style={{ width: `${(g.count / maxGenreCount) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right text-sm tabular-nums text-slate-500">{g.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top rated watched content */}
      {detailed && detailed.topRated.length > 0 && (
        <section className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-5">
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
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                      <Film className="h-8 w-8 text-slate-600" />
                    </div>
                  )}
                  {item.rating != null && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-bold text-amber-400 backdrop-blur-sm">
                      <Star className="h-3 w-3 fill-amber-400" />
                      {item.rating.toFixed(1)}
                    </div>
                  )}
                </div>
                <p className="mt-1.5 truncate text-sm font-medium text-slate-200">{item.name}</p>
                <p className="text-2xs text-slate-500 capitalize">{item.type}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
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
    red: { bg: "from-red-500/10", border: "border-red-500/20", icon: "text-red-400" },
    violet: { bg: "from-violet-500/10", border: "border-violet-500/20", icon: "text-violet-400" },
    amber: { bg: "from-amber-500/10", border: "border-amber-500/20", icon: "text-amber-400" },
    emerald: { bg: "from-emerald-500/10", border: "border-emerald-500/20", icon: "text-emerald-400" },
  };
  const c = colorMap[color];

  return (
    <div className={`rounded-2xl border ${c.border} bg-gradient-to-br ${c.bg} bg-slate-900/40 p-5`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800/80 ${c.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <span className="text-2xl font-bold text-white tabular-nums">
            {value.toLocaleString()}{suffix}
          </span>
          <p className="text-xs text-slate-400 font-medium">{label}</p>
        </div>
      </div>
    </div>
  );
}
