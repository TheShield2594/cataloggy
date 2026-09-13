import type { ElementType } from "react";
import { Link } from "react-router";
import { Clock, Film, Flame, Trophy, Tv } from "lucide-react";
import { useClockBoundary } from "../../hooks/useClockBoundary";
import { GREETING_CUTOFF_HOURS, showsSameHeader, timeOfDayGreeting } from "./greeting";

/**
 * The dashboard shows a greeting, not a title, so its h1 is hidden — every
 * render path still needs one to head the outline, including the API-error
 * card, which is why this is exported rather than drawn by the header alone.
 */
export function PageHeading() {
  return <h1 className="sr-only">Dashboard</h1>;
}

// The stat row's stand-in while getWatchStats and getDetailedStats are in
// flight. Without it the header renders as greeting + date only and then grows
// a whole row taller when the two calls land — on every dashboard load, warm
// ones included, because the calls are issued from their own effects. The
// widths are the chips' rough measure, enough to hold the line's height and
// keep the page below from being shoved down.
const STAT_CHIP_SKELETON_WIDTHS = ["w-24", "w-32", "w-20", "w-24", "w-20"];

function StatChipsSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-hidden="true">
      {STAT_CHIP_SKELETON_WIDTHS.map((width, i) => (
        <span key={i} className={`skeleton h-4 ${width} rounded`} />
      ))}
    </div>
  );
}

/**
 * The bites out of the header strip's left and right edges that make it a
 * ticket stub — the collectible-stat idea the Stats page's `TicketTile` is
 * named for, spent here on the row that actually carries the numbers on every
 * visit rather than on the page people open once a month.
 *
 * Page-coloured circles centred on the strip's edge: the half that lands
 * inside erases the border it crosses, and an interrupted border is what the
 * eye reads as a notch. Absolutely positioned on purpose — this row is one
 * line of chips wide on a laptop with the sidebar pinned, and a decoration
 * that took any width at all would spend the last of it and wrap the date
 * onto a second line. It sits in the padding, so it never meets the text.
 */
function TicketNotches() {
  const notch = "pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full";
  return (
    <span aria-hidden="true">
      <span className={`${notch} -left-1.5`} style={{ background: "var(--bg-0)" }} />
      <span className={`${notch} -right-1.5`} style={{ background: "var(--bg-0)" }} />
    </span>
  );
}

function StatChip({ icon: Icon, label, value, accent }: { icon: ElementType; label: string; value: string | number; accent?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-sm" style={{ color: accent ? undefined : "var(--text-dim)" }}>
      <Icon className={`h-3.5 w-3.5 ${accent ? "text-claw-text" : ""}`} style={accent ? undefined : { color: "var(--text-mute)" }} />
      {/* Tabular figures so a ticking count doesn't shuffle the label beside it. */}
      <span className={`tabular-nums ${accent ? "font-semibold text-claw-text" : ""}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="hidden sm:inline" style={{ color: "var(--text-mute)" }}>{label}</span>
    </span>
  );
}

/** Greeting, date, and the collectible stats, folded into one persistent strip. */
export function DashboardHeader({
  playsThisWeek,
  streak,
  longestStreak,
  totalMovies,
  totalEpisodes,
  topGenre,
  loading,
  statsLoading,
  statsFailed,
  onRetryStats,
}: {
  playsThisWeek: number;
  streak: number;
  longestStreak: number;
  totalMovies: number;
  totalEpisodes: number;
  topGenre?: string | undefined;
  loading: boolean;
  statsLoading: boolean;
  statsFailed: boolean;
  onRetryStats: () => void;
}) {
  const now = useClockBoundary(GREETING_CUTOFF_HOURS, showsSameHeader);
  const today = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return (
    <div
      className="glass-panel relative flex flex-col gap-2.5 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <PageHeading />
      <TicketNotches />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{timeOfDayGreeting(now)}</span>
        <span style={{ color: "var(--border-strong)" }}>&middot;</span>
        <span className="text-xs" style={{ color: "var(--text-mute)" }}>{today}</span>
      </div>
      {loading || statsLoading ? (
        <StatChipsSkeleton />
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <StatChip icon={Clock} label="this week" value={playsThisWeek} />
          {!statsFailed && streak > 0 && <StatChip icon={Flame} label={`day streak (best ${longestStreak})`} value={streak} accent />}
          <StatChip icon={Film} label="movies" value={totalMovies} />
          <StatChip icon={Tv} label="episodes" value={totalEpisodes} />
          {!statsFailed && topGenre && <StatChip icon={Trophy} label="top genre" value={topGenre} />}
          {/* Streak and top genre come from the detailed-stats call. When only
              that one fails, say so rather than rendering a 0-day streak and a
              missing genre as though they were the real numbers. */}
          {statsFailed && (
            <button
              type="button"
              onClick={onRetryStats}
              className="rounded text-xs font-medium underline-offset-2 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset"
              style={{ color: "var(--text-mute)" }}
            >
              Streak unavailable &middot; Retry
            </button>
          )}
          <Link to="/stats" className="text-xs font-medium text-claw-text underline-offset-2 transition-colors hover:underline">
            Full stats &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
