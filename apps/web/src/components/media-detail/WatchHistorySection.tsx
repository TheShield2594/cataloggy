import { Calendar, Clock, Film, Trash2, Tv } from "lucide-react";
import { Poster } from "../Poster";
import { WatchEvent } from "../../api";

export function WatchHistorySection({
  history,
  loading,
  onLogWatch,
  onDeleteEvent,
}: {
  history: WatchEvent[];
  loading: boolean;
  onLogWatch: () => void;
  onDeleteEvent: (eventId: string) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
          <Clock className="h-3.5 w-3.5" /> Watch History
        </h3>
        <button
          type="button"
          onClick={onLogWatch}
          className="inline-flex items-center gap-1.5 rounded-lg bg-claw-500/10 px-2.5 py-1 text-xs font-semibold text-claw-600 ring-1 ring-claw-500/20 hover:bg-claw-500/20 transition-colors"
        >
          <Calendar className="h-3 w-3" /> Log a Watch
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>
      ) : history.length === 0 ? (
        <p
          className="rounded-xl border py-5 text-center text-sm"
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-mute)" }}
        >
          No watch history yet
        </p>
      ) : (
        <div className="space-y-1.5">
          {history.map((event, index) => (
            <div
              key={event.id}
              className={`group flex items-center gap-3 rounded-lg border px-3 py-2 ${index === 0 ? "animate-slide-in" : ""}`}
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              <div className="h-10 w-7 shrink-0 overflow-hidden rounded-md" style={{ background: "var(--surface-strong)" }}>
                {event.poster ? (
                  <Poster src={event.poster} alt={event.name} className="h-full w-full" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    {event.type === "episode" ? (
                      <Tv className="h-3.5 w-3.5" style={{ color: "var(--text-mute)" }} />
                    ) : (
                      <Film className="h-3.5 w-3.5" style={{ color: "var(--text-mute)" }} />
                    )}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {event.type === "episode" && event.season != null && event.episode != null ? (
                  <>
                    <p className="truncate text-sm" style={{ color: "var(--text)" }}>{event.name}</p>
                    <p className="text-2xs" style={{ color: "var(--text-mute)" }}>
                      S{String(event.season).padStart(2, "0")}:E{String(event.episode).padStart(2, "0")}
                    </p>
                  </>
                ) : (
                  <p className="truncate text-sm" style={{ color: "var(--text)" }}>{event.name || "Watched"}</p>
                )}
              </div>
              <time className="shrink-0 text-2xs" style={{ color: "var(--text-mute)" }}>
                {new Date(event.watchedAt).toISOString().slice(0, 10) === "2000-01-01"
                  ? "Unknown date"
                  : new Date(event.watchedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </time>
              <button
                type="button"
                onClick={() => onDeleteEvent(event.id)}
                className="shrink-0 rounded p-1 text-[var(--text-mute)] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 hover:bg-rose-500/10 hover:text-rose-500 transition-all"
                aria-label="Remove watch event"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
