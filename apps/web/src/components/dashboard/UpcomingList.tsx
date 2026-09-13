import type { CalendarEntry } from "../../api";
import { Poster } from "../Poster";
import { localDateFromIsoDate } from "../../utils/calendarDate";

/** "Today", "Tomorrow", or the weekday and date an episode airs on. */
function airDateLabel(airDate: string): { label: string; isToday: boolean; isTomorrow: boolean } {
  // Unreadable stays an Invalid Date, which matches neither today nor tomorrow
  // and falls through to the dated label.
  const date = localDateFromIsoDate(airDate) ?? new Date(NaN);
  const isToday = date.toDateString() === new Date().toDateString();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  return {
    label: isToday
      ? "Today"
      : isTomorrow
        ? "Tomorrow"
        : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    isToday,
    isTomorrow,
  };
}

/** The next fortnight of episodes, in the dashboard's narrow right-hand column. */
export function UpcomingList({ entries }: { entries: CalendarEntry[] }) {
  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const { label, isToday, isTomorrow } = airDateLabel(entry.airDate);
        return (
          <div
            key={`${entry.seriesImdbId}-s${entry.season}e${entry.episode}`}
            className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 transition-all duration-base hover:border-[var(--border-strong)] hover:bg-[var(--surface-strong)]"
          >
            <div className="h-12 w-8 flex-none overflow-hidden rounded-md" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
              <Poster src={entry.poster ?? undefined} alt={entry.seriesName} className="h-full w-full" sizes="32px" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold" style={{ color: "var(--text)" }}>
                {entry.seriesName}
              </p>
              <p className="meta-row mt-0.5 truncate" style={{ color: "var(--text-dim)" }}>
                S{entry.season}:E{entry.episode}
              </p>
            </div>
            <span
              className={`meta-row flex-none rounded-full px-2 py-1 font-semibold ${
                isToday
                  ? "bg-claw-500/15 text-claw-text"
                  : isTomorrow
                    ? "bg-amber-500/15 text-warning"
                    : ""
              }`}
              style={!isToday && !isTomorrow ? { background: "var(--surface-strong)", color: "var(--text-dim)" } : undefined}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
