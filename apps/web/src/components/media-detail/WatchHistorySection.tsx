import { Calendar, ChevronRight, Clock, Trash2 } from "lucide-react";
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
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
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
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-11 rounded-lg" />)}</div>
      ) : history.length === 0 ? (
        <p className="rounded-xl bg-cream-50 border border-ink-100 py-5 text-center text-sm text-ink-500">
          No watch history yet
        </p>
      ) : (
        <div className="space-y-1.5">
          {history.map((event) => (
            <div key={event.id} className="group flex items-center gap-3 rounded-lg bg-cream-50 border border-ink-100 px-3 py-2.5">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-400" />
              <div className="min-w-0 flex-1">
                {event.season != null && event.episode != null ? (
                  <span className="text-sm text-ink-900">
                    S{String(event.season).padStart(2, "0")}:E{String(event.episode).padStart(2, "0")}
                  </span>
                ) : (
                  <span className="text-sm text-ink-900">Watched</span>
                )}
              </div>
              <time className="shrink-0 text-2xs text-ink-500">
                {new Date(event.watchedAt).getFullYear() === 2000 && new Date(event.watchedAt).getMonth() === 0
                  ? "Unknown date"
                  : new Date(event.watchedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </time>
              <button
                type="button"
                onClick={() => onDeleteEvent(event.id)}
                className="shrink-0 rounded p-1 text-ink-400 opacity-0 group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-500 transition-all"
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
