import { Film, Tv } from "lucide-react";
import type { ScrobbleSession } from "../../api";
import { KICKER } from "../typography";

/** What a media server says is playing right now — a live Plex/Jellyfin scrobble. */
export function NowPlayingList({ sessions }: { sessions: ScrobbleSession[] }) {
  if (sessions.length === 0) return null;
  return (
    <section className="space-y-2">
      {/* h2, not h3: this is a top-level dashboard section, and the only
          heading above it is the sr-only h1. The KICKER class is what makes
          it look like a kicker — the level says where it sits. */}
      <h2 className={`flex items-center gap-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        Playing now
      </h2>
      <div className="space-y-2">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="glass-panel flex items-center gap-3 rounded-xl p-3"
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
            <span className="meta-row flex-none" style={{ color: "var(--text-mute)" }}>
              {session.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
