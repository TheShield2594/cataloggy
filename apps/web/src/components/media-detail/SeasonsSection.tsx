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
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>Seasons</h3>
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-10 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (seasons.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
        <Tv className="h-3.5 w-3.5" /> Seasons
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {seasons.map((s) => (
          <div
            key={s.seasonNumber}
            className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div
              className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-xs font-bold"
              style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}
            >
              {s.seasonNumber}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: "var(--text)" }}>{s.name}</p>
              <p className="text-2xs" style={{ color: "var(--text-mute)" }}>{s.episodeCount} eps{s.airYear ? ` · ${s.airYear}` : ""}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
