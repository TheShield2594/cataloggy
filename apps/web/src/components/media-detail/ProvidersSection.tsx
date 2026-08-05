import { MonitorPlay } from "lucide-react";
import { WatchProviders } from "../../api";
import { KICKER } from "../typography";

export function ProvidersSection({ providers, loading }: { providers: WatchProviders | null; loading: boolean }) {
  // Reserve the section's space while the bundle loads — rendering null and
  // then appearing pushed everything below it down a beat after the panel
  // opened. Sized to the real chip row: 26px = py-1 + text-xs line height.
  if (loading) {
    return (
      <div>
        <h3 className={`mb-2 flex items-center gap-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>
          <MonitorPlay className="h-3.5 w-3.5" /> Where to Watch
        </h3>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-[26px] w-24 rounded-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!providers) return null;
  if (providers.flatrate.length === 0 && providers.free.length === 0) return null;

  const seen = new Set<number>();
  const uniqueProviders = [...providers.flatrate, ...providers.free].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return (
    <div>
      <h3 className={`mb-2 flex items-center gap-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>
        <MonitorPlay className="h-3.5 w-3.5" /> Where to Watch
      </h3>
      <div className="flex flex-wrap gap-2">
        {uniqueProviders.map((p) => (
          <span
            key={p.id}
            title={p.name}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
            style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}
          >
            {p.logo ? (
              <img src={p.logo} alt="" className="h-4 w-4 rounded" />
            ) : (
              <MonitorPlay className="h-3.5 w-3.5" style={{ color: "var(--text-mute)" }} />
            )}
            {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}
