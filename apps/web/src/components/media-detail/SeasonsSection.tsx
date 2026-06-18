import { Tv } from "lucide-react";

export interface SeasonInfo {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airYear: number | null;
  poster: string | null;
}

export function SeasonsSection({ seasons, loading }: { seasons: SeasonInfo[]; loading: boolean }) {
  if (loading) {
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Seasons</h3>
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-10 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (seasons.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
        <Tv className="h-3.5 w-3.5" /> Seasons
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {seasons.map((s) => (
          <div key={s.seasonNumber} className="flex items-center gap-2.5 rounded-xl bg-cream-50 border border-ink-100 px-3 py-2.5">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-ink-100 text-xs font-bold text-ink-700">
              {s.seasonNumber}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-900 truncate">{s.name}</p>
              <p className="text-2xs text-ink-500">{s.episodeCount} eps{s.airYear ? ` · ${s.airYear}` : ""}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
