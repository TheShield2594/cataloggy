import { useEffect, useState, useCallback, useRef } from "react";
import {
  AlertCircle,
  Film,
  Tv,
  ChevronRight,
  ChevronLeft,
  Check,
  TrendingUp,
  Sparkles,
  X,
  Flame,
  Trophy,
  Clock,
} from "lucide-react";
import {
  api,
  CalendarEntry,
  CheckIn,
  DetailedWatchStats,
  runtimeConfig,
  ScrobbleSession,
  SearchResult,
  SeriesProgress,
  TrendingMeta,
  WatchEvent,
  WatchStats,
} from "../api";
import { Link } from "react-router";
import { CarouselTrack } from "../components/CarouselTrack";
import { useHorizontalScroll } from "../components/carousel-utils";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { Poster } from "../components/Poster";
import { useToast } from "../hooks/useToast";
import { timeAgo, timeUntil } from "../utils/timeAgo";
import { formatRating, ratingLabel } from "../utils/rating";
import { useCachedState } from "../hooks/useCachedState";

/* ─── Skeleton placeholders ─── */

function ContinueWatchingSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden pb-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex-none">
          <div className="skeleton h-[16.5rem] w-[11rem] rounded-xl" />
          <div className="skeleton mt-2.5 h-4 w-32 rounded" />
          <div className="skeleton mt-1.5 h-3 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}

function RecentlyWatchedSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden pb-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex-none">
          <div className="skeleton h-[16.5rem] w-[11rem] rounded-xl" />
          <div className="skeleton mt-2.5 h-4 w-28 rounded" />
          <div className="skeleton mt-1.5 h-3 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

/* ─── Discovery Card ─── */

type DiscoveryItem = {
  id: string;
  name: string;
  poster?: string;
  rating?: number;
  genres?: string[];
  year?: number;
  type?: string;
  description?: string;
};

export function DiscoveryCard({ item, badge, reason, onSelect, eager, fill }: {
  item: DiscoveryItem;
  badge?: React.ReactNode;
  reason?: string;
  onSelect?: (item: DiscoveryItem) => void;
  eager?: boolean;
  /** Fills the width of a grid cell instead of using a fixed carousel-card width. */
  fill?: boolean;
}) {
  return (
    <div
      className={`group relative rounded-xl ${fill ? "w-full" : "flex-none"}`}
      style={fill ? undefined : { width: "11rem" }}
    >
      {/* A real button rather than a `role="button"` div: it inherits Enter and
          Space, the disabled/active semantics, and the announcement assistive
          tech expects, instead of re-implementing the first and forgoing the
          rest. It stretches over the whole card because the card is one action
          — there is nothing else here to overlap with. */}
      {onSelect && (
        <button
          type="button"
          className="absolute inset-0 z-10 cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
          onClick={() => onSelect(item)}
          aria-label={`View details for ${item.name}`}
        />
      )}
      <div
        className="relative aspect-poster overflow-hidden rounded-xl shadow-lg transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-card-hover"
        style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}
      >
        <Poster src={item.poster} alt={item.name} className="h-full w-full" eager={eager} sizes="176px" />
        {item.rating != null && item.rating > 0 && (
          // 28px of chip has no room for "/10", so the scale lives in the
          // accessible name and the tooltip instead of being left implied.
          <div
            role="img"
            aria-label={ratingLabel(item.rating)}
            title={ratingLabel(item.rating)}
            className="absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 backdrop-blur-sm"
            style={{ boxShadow: "0 0 0 1.5px rgba(245,158,11,0.7)" }}
          >
            <span aria-hidden="true" className="text-2xs font-bold tabular-nums text-amber-400">{formatRating(item.rating)}</span>
          </div>
        )}
        {badge && <div className="absolute top-2 right-2">{badge}</div>}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/55 to-transparent px-3 pb-2.5 pt-10 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
          <p className="truncate text-xs font-semibold text-white">{item.name}</p>
        </div>
      </div>
      <p className="mt-2.5 truncate text-sm font-semibold text-[var(--text)] transition-colors group-hover:text-claw-text">
        {item.name}
      </p>
      <p className="truncate text-2xs" style={{ color: "var(--text-dim)" }}>
        {item.year ?? ""}
        {item.type ? ` · ${item.type === "movie" ? "Movie" : "Series"}` : ""}
        {item.genres && item.genres.length > 0 ? ` · ${item.genres.slice(0, 2).join(", ")}` : ""}
      </p>
      {reason && (
        <p className="mt-0.5 line-clamp-2 text-2xs italic leading-snug" style={{ color: "var(--text-dim)" }} title={reason}>
          {reason}
        </p>
      )}
    </div>
  );
}

/* ─── Continue Watching card (used for every item after the hero) ─── */

/**
 * The IMDb id the detail panel should open for a history row.
 *
 * An episode row carries the episode's own id in `imdbId` and its series' in
 * `seriesImdbId`. The panel is about the series — opening it on the episode id
 * looks up a title that isn't there. `HistoryPage` has always made this
 * distinction; the dashboard's Recently Watched carousel did not.
 */
export function historyItemImdbId(
  event: Pick<WatchEvent, "type" | "imdbId" | "seriesImdbId">
): string {
  return event.type === "episode" ? (event.seriesImdbId ?? event.imdbId) : event.imdbId;
}

const pctOf = (watched: number, total: number) => Math.min(Math.max((watched / total) * 100, 0), 100);

export function computeProgressPct(s: SeriesProgress): number | null {
  return typeof s.watchedEpisodes === "number" && s.totalEpisodes && s.totalEpisodes > 0
    ? pctOf(s.watchedEpisodes, s.totalEpisodes)
    : null;
}

export type ProgressSummary = { label: string; watched: number; total: number; pct: number };

/**
 * The bar the featured card draws, and what to call it.
 *
 * The season the viewer is actually in is the useful reading next to the
 * `S1:E5` marker above it, so it wins when TMDB knows how long that season is.
 * Series-wide totals are the fallback, and they're labelled as such — filling a
 * bar called "Season progress" from the series total is what made a show five
 * episodes into season 1 of 3 read `5 / 27 episodes` against a near-empty bar.
 */
export function computeProgressSummary(s: SeriesProgress): ProgressSummary | null {
  if (
    typeof s.seasonWatchedEpisodes === "number" &&
    typeof s.seasonTotalEpisodes === "number" &&
    s.seasonTotalEpisodes > 0
  ) {
    return {
      label: "Season progress",
      watched: s.seasonWatchedEpisodes,
      total: s.seasonTotalEpisodes,
      pct: pctOf(s.seasonWatchedEpisodes, s.seasonTotalEpisodes),
    };
  }
  if (typeof s.watchedEpisodes === "number" && s.totalEpisodes && s.totalEpisodes > 0) {
    return {
      label: "Series progress",
      watched: s.watchedEpisodes,
      total: s.totalEpisodes,
      pct: pctOf(s.watchedEpisodes, s.totalEpisodes),
    };
  }
  return null;
}

/**
 * The ` · 4 seasons` suffix under a Continue Watching title, empty when the
 * season count is unknown. Interpolating the number straight in gave a
 * one-season show `1 seasons`.
 */
export function seasonCountSuffix(totalSeasons: number | null | undefined): string {
  if (!totalSeasons || totalSeasons < 1) return "";
  return ` · ${totalSeasons} season${totalSeasons === 1 ? "" : "s"}`;
}

export function ContinueWatchingCard({
  s,
  eager,
  isMarking,
  isDone,
  onMarkNext,
  onSelect,
}: {
  s: SeriesProgress;
  eager: boolean;
  isMarking: boolean;
  isDone: boolean;
  onMarkNext: () => void;
  onSelect: () => void;
}) {
  const progressPct = computeProgressPct(s);
  return (
    // One card, two controls — grouped and labelled so a screen reader announces
    // them as belonging to this series rather than as loose buttons in a row.
    <div role="group" aria-label={s.name} className="flex-none group" style={{ width: "13rem" }}>
      <div
        className="relative aspect-poster overflow-hidden rounded-2xl shadow-lg transition-all duration-300 group-hover:shadow-card-hover"
        style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}
      >
        <Poster src={s.poster} alt={s.name} className="absolute inset-0 h-full w-full" eager={eager} sizes="208px" />
        {/* The poster is a backdrop and the two controls are siblings in a
            column above it: "view details" takes the space the overlay doesn't,
            "mark next" lives inside the overlay. Neither covers the other, so
            which one a click lands on is a matter of layout rather than z-order. */}
        <div className="relative flex h-full flex-col">
          <button
            type="button"
            className="flex-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-claw-300"
            aria-label={`View details for ${s.name}`}
            onClick={onSelect}
          />
          <div className="bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-16">
            {progressPct !== null && (
              <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-claw-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
            )}
            <p className="text-xs text-white/70">
              S{s.lastSeason}:E{s.lastEpisode}
              {seasonCountSuffix(s.totalSeasons)}
            </p>
            <button
              type="button"
              disabled={isMarking || isDone}
              onClick={onMarkNext}
              aria-label={isMarking ? "Marking" : isDone ? "Marked" : `Mark S${s.nextSeason}:E${s.nextEpisode}`}
              className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-claw-300 ${
                isMarking ? "bg-white/10 text-white/50" : isDone ? "bg-emerald-500/20 text-emerald-400" : "bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
              }`}
            >
              {isDone ? (
                <><Check className="h-3.5 w-3.5" /> Marked</>
              ) : isMarking ? (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "transparent" }} />
              ) : (
                <><ChevronRight className="h-3.5 w-3.5" /> Mark S{s.nextSeason}:E{s.nextEpisode}</>
              )}
            </button>
          </div>
        </div>
      </div>
      {/* Plain text, not a third control: it opened the same panel the poster
          already opens, which cost a keyboard user an extra stop per card. */}
      <p className="mt-2.5 truncate text-sm font-semibold text-[var(--text)] transition-colors group-hover:text-claw-text">
        {s.name}
      </p>
      {progressPct !== null && (
        <p className="text-2xs" style={{ color: "var(--text-dim)" }}>
          {s.watchedEpisodes} of {s.totalEpisodes} episodes
        </p>
      )}
    </div>
  );
}

/* ─── Continue Watching hero — the first in-progress item, featured ─── */

export function ContinueWatchingHero({
  s,
  isMarking,
  isDone,
  onMarkNext,
  onSelect,
}: {
  s: SeriesProgress;
  isMarking: boolean;
  isDone: boolean;
  onMarkNext: () => void;
  onSelect: () => void;
}) {
  const progress = computeProgressSummary(s);
  const heroArt = s.background ?? s.poster;
  return (
    <div
      className="relative mb-3 flex flex-col gap-4 overflow-hidden rounded-2xl p-4 sm:flex-row sm:items-center"
      style={{ minHeight: "10.5rem", border: "1px solid var(--border)" }}
    >
      {heroArt && (
        <img
          src={heroArt}
          alt=""
          aria-hidden="true"
          className={`absolute inset-0 h-full w-full object-cover scale-110 ${s.background ? "opacity-60" : "blur-2xl opacity-40"}`}
        />
      )}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(110deg, var(--bg-0) 15%, color-mix(in srgb, var(--bg-0) 35%, transparent) 60%, transparent)" }}
      />
      <div className="relative z-10 h-40 w-28 flex-none overflow-hidden rounded-xl shadow-feature" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
        <Poster src={s.poster} alt={s.name} className="h-full w-full" eager sizes="112px" />
      </div>
      <div className="relative z-10 min-w-0 flex-1">
        <p className="text-2xs font-bold uppercase tracking-wider text-claw-text">Series &middot; In Progress</p>
        <p className="mt-1 truncate font-heading text-xl font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{s.name}</p>
        <p className="mt-0.5 text-sm" style={{ color: "var(--text-dim)" }}>
          S{s.lastSeason}:E{s.lastEpisode}
          {seasonCountSuffix(s.totalSeasons)}
        </p>
        {progress && (
          <div className="mt-3 max-w-xs">
            <div className="mb-1.5 flex items-center justify-between text-2xs" style={{ color: "var(--text-mute)" }}>
              <span>{progress.label}</span>
              <span className="font-semibold text-claw-text">{progress.watched} / {progress.total} episodes</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-strong)" }}>
              <div className="h-full rounded-full bg-claw-500 transition-all duration-500" style={{ width: `${progress.pct}%` }} />
            </div>
          </div>
        )}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={isMarking || isDone}
            onClick={onMarkNext}
            aria-label={isMarking ? "Marking" : isDone ? "Marked" : `Mark S${s.nextSeason}:E${s.nextEpisode}`}
            className="flex items-center gap-1.5 rounded-xl bg-claw-500 px-4 py-2.5 text-sm font-semibold text-claw-on transition-all active:scale-[0.98] hover:bg-claw-600 disabled:opacity-60"
          >
            {isDone ? (
              <><Check className="h-4 w-4" /> Marked</>
            ) : isMarking ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-transparent" />
            ) : (
              <><ChevronRight className="h-4 w-4" /> Mark S{s.nextSeason}:E{s.nextEpisode}</>
            )}
          </button>
          <button
            type="button"
            onClick={onSelect}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.98]"
            style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)", color: "var(--text-dim)" }}
          >
            Details
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Scroll arrows ─── */

function ScrollArrows({
  canScrollLeft,
  canScrollRight,
  onScroll,
}: {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  onScroll: (dir: "left" | "right") => void;
}) {
  const scrollable = canScrollLeft || canScrollRight;
  return (
    // Stays mounted when the row fits on screen so a resize fades the cluster
    // out instead of blinking it away; disabled buttons keep it untabbable.
    <div
      className={`flex items-center gap-1.5 transition-opacity duration-300 ${scrollable ? "" : "pointer-events-none opacity-0"}`}
      aria-hidden={!scrollable}
    >
      <button
        type="button"
        onClick={() => onScroll("left")}
        disabled={!canScrollLeft}
        className="flex h-8 w-8 items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:cursor-default active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
        style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)", color: "var(--text-dim)" }}
        aria-label="Scroll left"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onScroll("right")}
        disabled={!canScrollRight}
        className="flex h-8 w-8 items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:cursor-default active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
        style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)", color: "var(--text-dim)" }}
        aria-label="Scroll right"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ─── Section header ─── */

function SectionHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>{title}</h2>
        {count !== undefined && count > 0 && (
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums"
            style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}
          >
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/* ─── Section-level failure notice ───
 *
 * A section whose loader failed keeps its container and says so, rather than
 * rendering nothing. Silently dropping the section made the dashboard look
 * merely different that day, with no hint that anything was wrong or that
 * retrying would help — and, for Upcoming, collapsed the two-column grid.
 */

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl py-8 text-center" style={{ border: "1px dashed var(--border-strong)" }}>
      <AlertCircle className="h-7 w-7" style={{ color: "var(--text-mute)" }} />
      <p className="text-sm" style={{ color: "var(--text-dim)" }}>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm font-medium text-claw-text underline-offset-2 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset rounded"
      >
        Retry
      </button>
    </div>
  );
}

/* ─── Discover sub-row: one labeled rail (Movies / Series) within the shared Discover section ─── */

function DiscoverSubRow({
  label,
  loading,
  failed,
  onRetry,
  items,
  reasons,
  aiActive,
  scroll,
  onSelect,
}: {
  label: string;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  items: TrendingMeta[];
  reasons: Record<string, string>;
  aiActive: boolean;
  scroll: ReturnType<typeof useHorizontalScroll>;
  onSelect: (item: DiscoveryItem) => void;
}) {
  if (!loading && !failed && items.length === 0) return null;
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>{label}</h3>
        {!loading && !failed && items.length > 0 && (
          <ScrollArrows canScrollLeft={scroll.canScrollLeft} canScrollRight={scroll.canScrollRight} onScroll={scroll.scroll} />
        )}
      </div>
      {failed && !loading ? (
        <SectionError message={`Couldn't load ${label.toLowerCase()} recommendations.`} onRetry={onRetry} />
      ) : loading ? (
        aiActive
          ? <p className="text-sm italic" style={{ color: "var(--text-dim)" }}>Generating AI recommendations...</p>
          : <ContinueWatchingSkeleton />
      ) : (
        <CarouselTrack
          scrollRef={scroll.ref}
          canScrollLeft={scroll.canScrollLeft}
          canScrollRight={scroll.canScrollRight}
          className="gap-4"
        >
          {items.map((item) => (
            <DiscoveryCard
              key={item.id}
              item={item}
              reason={reasons[item.id]}
              onSelect={onSelect}
              badge={
                <span className="inline-flex items-center gap-1 rounded-md bg-plum-500/80 px-1.5 py-0.5 text-2xs font-semibold text-white backdrop-blur-sm">
                  <Sparkles className="h-2.5 w-2.5" />
                  {aiActive && <span>AI</span>}
                </span>
              }
            />
          ))}
        </CarouselTrack>
      )}
    </div>
  );
}

/* ─── Header stat row: greeting + the collectible stats folded into one persistent strip ─── */

// The dashboard shows a greeting, not a title, so its h1 is hidden — every render
// path still needs one to head the outline, including the API-error card.
function PageHeading() {
  return <h1 className="sr-only">Dashboard</h1>;
}

export function timeOfDayGreeting(now: Date) {
  const hour = now.getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// The hours at which the header's two clock-derived strings change: the
// greeting cutoffs above, plus midnight, which also rolls the date over.
const GREETING_CUTOFF_HOURS = [0, 5, 12, 18];

export function msUntilNextBoundary(now: Date): number {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  const nextCutoff = GREETING_CUTOFF_HOURS.find((hour) => hour > now.getHours());
  if (nextCutoff === undefined) {
    next.setDate(next.getDate() + 1);
    next.setHours(0);
  } else {
    next.setHours(nextCutoff);
  }
  // A DST shift can land the "next" boundary in the past; never schedule a
  // zero-delay timeout that would spin.
  return Math.max(next.getTime() - now.getTime(), 60_000);
}

/**
 * The current time, re-read whenever the greeting or the date would change.
 *
 * Both were computed once at render, so a dashboard left open overnight kept
 * saying "Good evening" under yesterday's date. Waking at the boundaries costs
 * four re-renders a day rather than a poll running all night.
 */
// Whether two instants would render the header identically. Returning the
// previous Date when they would lets React bail out of the re-render, so the
// common case — the effect running microseconds after the first render — costs
// nothing.
export const showsSameHeader = (a: Date, b: Date) =>
  timeOfDayGreeting(a) === timeOfDayGreeting(b) && a.toDateString() === b.toDateString();

function useClockBoundary(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const schedule = (current: Date) => {
      timer = setTimeout(() => {
        const updated = new Date();
        setNow(updated);
        schedule(updated);
      }, msUntilNextBoundary(current));
    };

    // A suspended laptop wakes with a timeout that was scheduled yesterday still
    // pending, so re-read the clock on the way back rather than wait it out.
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      const updated = new Date();
      setNow(updated);
      schedule(updated);
    };

    // Schedule from the same value the header is showing. The clock can cross a
    // cutoff between the first render and this effect, and scheduling from a
    // fresher Date than the one on screen would leave the two disagreeing until
    // the *next* cutoff — a stale greeting for hours, not milliseconds.
    const current = new Date();
    setNow((previous) => (showsSameHeader(previous, current) ? previous : current));
    schedule(current);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return now;
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

function StatChip({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: string | number; accent?: boolean }) {
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

function DashboardHeader({
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
  topGenre?: string;
  loading: boolean;
  statsLoading: boolean;
  statsFailed: boolean;
  onRetryStats: () => void;
}) {
  const now = useClockBoundary();
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
              className="rounded text-xs font-medium underline-offset-2 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
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

/* ─── Main component ─── */

export function DashboardPage() {
  // Each section keeps its data in the shared cache, so leaving the dashboard
  // and coming back paints the same content in the first frame rather than
  // spinning while the requests it already made are made again. The loads below
  // are unchanged and still run on mount — they now refresh what is on screen
  // instead of replacing it.
  const [progress, setProgress, progressMeta] = useCachedState<SeriesProgress[]>("dash:progress", []);
  const [history, setHistory, historyMeta] = useCachedState<WatchEvent[]>("dash:history", []);
  const [stats, setStats] = useCachedState<WatchStats | null>("dash:stats", null);

  const [loading, setLoading] = useState(!progressMeta.hadCachedValue && !historyMeta.hadCachedValue);
  const [error, setError] = useState<string | null>(null);

  const [detailedStats, setDetailedStats, detailedMeta] = useCachedState<DetailedWatchStats | null>("dash:detailed-stats", null);
  const [detailedLoading, setDetailedLoading] = useState(!detailedMeta.hadCachedValue);
  const [detailedFailed, setDetailedFailed] = useState(false);

  const [trendingMovies, setTrendingMovies, trendingMeta] = useCachedState<TrendingMeta[]>("dash:trending", []);
  const [trendingLoading, setTrendingLoading] = useState(!trendingMeta.hadCachedValue);
  const [trendingNeedsTmdb, setTrendingNeedsTmdb] = useState(false);
  const [recommendations, setRecommendations, recsMeta] = useCachedState<TrendingMeta[]>("dash:recs:movie", []);
  const [recsLoading, setRecsLoading] = useState(!recsMeta.hadCachedValue);
  const [recsFailed, setRecsFailed] = useState(false);
  const [seriesRecs, setSeriesRecs, seriesRecsMeta] = useCachedState<TrendingMeta[]>("dash:recs:series", []);
  const [seriesRecsLoading, setSeriesRecsLoading] = useState(!seriesRecsMeta.hadCachedValue);
  const [seriesRecsFailed, setSeriesRecsFailed] = useState(false);
  const [aiActive, setAiActive] = useState(false);
  const [aiLastGeneratedAt, setAiLastGeneratedAt] = useState<string | null>(null);
  const [movieReasons, setMovieReasons] = useState<Record<string, string>>({});
  const [seriesReasons, setSeriesReasons] = useState<Record<string, string>>({});
  const [calendarEntries, setCalendarEntries, calendarMeta] = useCachedState<CalendarEntry[]>("dash:calendar", []);
  const [calendarLoading, setCalendarLoading] = useState(!calendarMeta.hadCachedValue);
  const [calendarFailed, setCalendarFailed] = useState(false);

  const [markingNext, setMarkingNext] = useState<Set<string>>(new Set());
  const [markedDone, setMarkedDone] = useState<Set<string>>(new Set());
  const [activeCheckin, setActiveCheckin] = useState<CheckIn | null>(null);
  const [nowPlaying, setNowPlaying] = useState<ScrobbleSession[]>([]);

  const continueScroll = useHorizontalScroll();
  const recentScroll = useHorizontalScroll();
  const recsScroll = useHorizontalScroll();
  const seriesRecsScroll = useHorizontalScroll();

  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading, detail: panelDetail, detailLoading: panelDetailLoading } = useDetailPanel();
  const { showToast } = useToast();

  const toSearchResult = useCallback((imdbId: string, type: "movie" | "series", name: string, opts?: {
    poster?: string; year?: number | null; description?: string | null; genres?: string[]; rating?: number | null; background?: string | null;
  }): SearchResult => ({
    imdbId, type, name,
    year: opts?.year ?? null,
    poster: opts?.poster ?? null,
    description: opts?.description ?? null,
    genres: opts?.genres ?? [],
    rating: opts?.rating ?? null,
    inWatchlist: false,
    inCollection: false,
    lists: [],
    background: opts?.background ?? null,
  }), []);

  const load = useCallback(async () => {
    try {
      const [progressRes, historyRes, statsRes, checkinRes, nowPlayingRes] = await Promise.all([
        api.getSeriesProgress(),
        api.getWatchHistory(20),
        api.getWatchStats(),
        api.getCheckin().catch(() => ({ checkin: null })),
        api.getNowPlaying().catch(() => ({ sessions: [] })),
      ]);
      setProgress(progressRes ?? []);
      setHistory(historyRes ?? []);
      setStats(statsRes);
      setActiveCheckin(checkinRes.checkin);
      setNowPlaying(nowPlayingRes.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProgress = useCallback(async () => {
    try {
      const progressRes = await api.getSeriesProgress();
      setProgress(progressRes ?? []);
    } catch { /* keep showing the last known list */ }
  }, []);

  const profileId = runtimeConfig.getProfileId();

  // Each section loader is callable on its own so its error state can offer a
  // retry. The token guard keeps the newest call's result: a retry, or a
  // profile switch, must not be overwritten by the slower request it replaced.
  const detailedToken = useRef(0);
  const loadDetailedStats = useCallback(async () => {
    const token = ++detailedToken.current;
    setDetailedLoading(true);
    setDetailedFailed(false);
    try {
      const res = await api.getDetailedStats();
      if (detailedToken.current === token) setDetailedStats(res);
    } catch (err) {
      console.error("Failed to fetch detailed stats:", err);
      if (detailedToken.current === token) setDetailedFailed(true);
    } finally {
      if (detailedToken.current === token) setDetailedLoading(false);
    }
  }, []);

  const trendingToken = useRef(0);
  const loadTrending = useCallback(async () => {
    const token = ++trendingToken.current;
    setTrendingLoading(true);
    setTrendingNeedsTmdb(false);
    try {
      const res = await api.getTrending("movie", "week");
      if (trendingToken.current === token) setTrendingMovies(res.metas ?? []);
    } catch (err) {
      console.error("Failed to fetch trending:", err);
      if (trendingToken.current === token) {
        setTrendingMovies([]);
        setTrendingNeedsTmdb(err instanceof Error && /tmdb/i.test(err.message));
      }
    } finally {
      if (trendingToken.current === token) setTrendingLoading(false);
    }
  }, []);

  const recsToken = useRef(0);
  const loadRecs = useCallback(async (kind: "movie" | "series") => {
    const isMovie = kind === "movie";
    const setLoadingFor = isMovie ? setRecsLoading : setSeriesRecsLoading;
    const setFailedFor = isMovie ? setRecsFailed : setSeriesRecsFailed;
    const token = recsToken.current;
    setLoadingFor(true);
    setFailedFor(false);
    try {
      const res = await api.getAiRecommendations(kind, 20);
      if (recsToken.current !== token) return;
      if (isMovie) {
        setRecommendations(res.metas ?? []);
        setMovieReasons(res.reasons ?? {});
      } else {
        setSeriesRecs(res.metas ?? []);
        setSeriesReasons(res.reasons ?? {});
      }
    } catch (err) {
      console.error(`Failed to fetch ${kind} recommendations:`, err);
      if (recsToken.current === token) setFailedFor(true);
    } finally {
      if (recsToken.current === token) setLoadingFor(false);
    }
  }, []);

  // AI config gates both rails: a failure here means neither can be fetched, so
  // it surfaces as a failure on both rather than as two empty rows.
  const loadAiSection = useCallback(async () => {
    const token = ++recsToken.current;
    setRecsLoading(true);
    setSeriesRecsLoading(true);
    setRecsFailed(false);
    setSeriesRecsFailed(false);
    try {
      const configRes = await api.getAiConfig();
      if (recsToken.current !== token) return;
      setAiActive(configRes.configured);
      setAiLastGeneratedAt(configRes.lastGeneratedAt ?? null);

      if (!configRes.configured) {
        setRecsLoading(false);
        setSeriesRecsLoading(false);
        return;
      }

      void loadRecs("movie");
      void loadRecs("series");
    } catch (err) {
      console.error("Failed to fetch AI config:", err);
      if (recsToken.current !== token) return;
      setRecsFailed(true);
      setSeriesRecsFailed(true);
      setRecsLoading(false);
      setSeriesRecsLoading(false);
    }
  }, [loadRecs]);

  const calendarToken = useRef(0);
  const loadCalendar = useCallback(async () => {
    const token = ++calendarToken.current;
    setCalendarLoading(true);
    setCalendarFailed(false);
    try {
      const res = await api.getCalendar(14);
      if (calendarToken.current === token) setCalendarEntries(res.calendar ?? []);
    } catch (err) {
      console.error("Failed to fetch calendar:", err);
      if (calendarToken.current === token) setCalendarFailed(true);
    } finally {
      if (calendarToken.current === token) setCalendarLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDetailedStats();
    void loadTrending();
    void loadAiSection();
    void loadCalendar();
  }, [profileId, loadDetailedStats, loadTrending, loadAiSection, loadCalendar]);

  useEffect(() => { void load(); }, [load, profileId]);

  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      continueScroll.checkScroll();
      recentScroll.checkScroll();
      recsScroll.checkScroll();
      seriesRecsScroll.checkScroll();
    }, 50);
    return () => clearTimeout(timer);
  }, [loading, trendingLoading, recsLoading, seriesRecsLoading, progress.length, history.length,
    continueScroll.checkScroll, recentScroll.checkScroll,
    recsScroll.checkScroll, seriesRecsScroll.checkScroll]);

  const handleMarkNext = async (imdbId: string) => {
    setMarkingNext((prev) => new Set(prev).add(imdbId));
    try {
      await api.markNextEpisodeWatched(imdbId);
      setMarkedDone((prev) => new Set(prev).add(imdbId));
      setTimeout(() => {
        setMarkedDone((prev) => { const next = new Set(prev); next.delete(imdbId); return next; });
        void load();
      }, 1200);
    } catch {
      // Mark failed (e.g. the series turned out to already be fully watched) —
      // reload so a now-stale card can be dropped from the list.
      void load();
    } finally {
      setMarkingNext((prev) => { const next = new Set(prev); next.delete(imdbId); return next; });
    }
  };

  if (error) {
    return (
      <>
        <PageHeading />
        <div
          className="mx-auto max-w-lg space-y-4 rounded-2xl border border-claw-400/20 bg-claw-400/5 p-8 text-center"
        >
          <AlertCircle className="mx-auto h-12 w-12 text-claw-text" />
          <p className="text-xl font-semibold text-claw-text">Unable to connect to the API</p>
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>{error}</p>
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            API base: <span className="font-mono text-claw-text">{runtimeConfig.getApiBase()}</span>
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-claw-500 px-5 py-2.5 text-sm font-semibold text-claw-on hover:bg-claw-600 transition-colors active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400"
            >
              Reload
            </button>
            <Link
              to="/settings"
              className="rounded-lg px-5 py-2.5 text-sm font-medium transition-colors focus:outline-none"
              style={{ border: "1px solid var(--border-strong)", color: "var(--text-dim)" }}
            >
              Settings
            </Link>
          </div>
        </div>
      </>
    );
  }

  const handleCheckout = async (logWatch: boolean) => {
    await api.endCheckin(logWatch);
    setActiveCheckin(null);
    if (logWatch) void load();
  };

  // Includes the failure case so the column — and the two-column grid with it —
  // stays put and reports the problem instead of quietly reflowing to one column.
  const hasUpcoming = calendarLoading || calendarEntries.length > 0 || calendarFailed;

  // The check-in hero and the Continue Watching hero can end up showing the same series
  // (e.g. actively checked into the episode that's also furthest along in progress).
  // When that happens, skip the redundant Continue hero and fold that series into the row instead.
  const checkinSeriesId = activeCheckin ? (activeCheckin.type === "episode" ? activeCheckin.seriesImdbId : activeCheckin.imdbId) : null;
  const checkinMatchesTopProgress = checkinSeriesId != null && progress[0]?.imdbId === checkinSeriesId;
  const continueHeroItem = checkinMatchesTopProgress ? undefined : progress[0];
  const continueRowItems = checkinMatchesTopProgress ? progress : progress.slice(1);

  return (
    <div className="space-y-8">
      {/* ── Header stat row ── */}
      <DashboardHeader
        playsThisWeek={stats?.playsThisWeek ?? 0}
        streak={detailedStats?.currentStreak ?? 0}
        longestStreak={detailedStats?.longestStreak ?? 0}
        totalMovies={stats?.totalMovies ?? 0}
        totalEpisodes={stats?.totalEpisodes ?? 0}
        topGenre={detailedStats?.genreDistribution[0]?.genre}
        loading={loading}
        statsLoading={detailedLoading}
        statsFailed={detailedFailed}
        onRetryStats={() => void loadDetailedStats()}
      />

      {/* ── Hero: Now Watching ── */}
      {activeCheckin && (
        <section
          className="relative overflow-hidden rounded-3xl"
          style={{ minHeight: "13rem", border: "1px solid var(--border)" }}
        >
          {(activeCheckin.background ?? activeCheckin.poster) && (
            <img
              src={activeCheckin.background ?? activeCheckin.poster}
              alt=""
              aria-hidden="true"
              className={`absolute inset-0 h-full w-full object-cover scale-110 ${activeCheckin.background ? "opacity-70" : "blur-2xl opacity-50"}`}
            />
          )}
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(110deg, var(--bg-0) 15%, color-mix(in srgb, var(--bg-0) 35%, transparent) 60%, transparent)" }}
          />
          <div className="relative z-10 flex h-full flex-col gap-5 p-6 sm:flex-row sm:items-center">
            {activeCheckin.poster && (
              <div className="h-32 w-[5.5rem] flex-none overflow-hidden rounded-xl shadow-feature" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
                <img src={activeCheckin.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-claw-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-claw-500" />
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-claw-text">Now Watching</span>
              </div>
              <p className="mt-1 truncate font-heading text-2xl font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{activeCheckin.name}</p>
              {activeCheckin.season != null && activeCheckin.episode != null && (
                <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
                  S{String(activeCheckin.season).padStart(2, "0")}:E{String(activeCheckin.episode).padStart(2, "0")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-none">
              <button
                type="button"
                onClick={() => void handleCheckout(true)}
                className="flex items-center gap-1.5 rounded-xl bg-claw-500 px-4 py-2.5 text-sm font-semibold text-claw-on hover:bg-claw-600 active:scale-[0.98] transition-all"
              >
                <Check className="h-4 w-4" /> Finished
              </button>
              <button
                type="button"
                onClick={() => void handleCheckout(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl transition-all active:scale-95"
                style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)", color: "var(--text-dim)" }}
                aria-label="Check out without logging"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Live: Plex/Jellyfin scrobble sessions ── */}
      {nowPlaying.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Playing now
          </h3>
          <div className="space-y-2">
            {nowPlaying.map((session) => (
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
                <span className="flex-none text-2xs font-medium capitalize" style={{ color: "var(--text-mute)" }}>
                  {session.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Continue Watching ── */}
      <section>
        <SectionHeader title="Continue Watching" count={progress.length}>
          {!loading && progress.length > 0 && (
            <ScrollArrows
              canScrollLeft={continueScroll.canScrollLeft}
              canScrollRight={continueScroll.canScrollRight}
              onScroll={continueScroll.scroll}
            />
          )}
        </SectionHeader>
        {loading ? (
          <ContinueWatchingSkeleton />
        ) : progress.length === 0 ? (
          <div className="rounded-2xl py-12 text-center" style={{ border: "1px dashed var(--border-strong)" }}>
            <Tv className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
            <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>
              No series in progress. Series you start watching pick up here.
            </p>
            <Link to="/search" className="mt-1 inline-block text-sm font-medium text-claw-text underline-offset-2 transition-colors hover:underline">
              Find something to watch &rarr;
            </Link>
          </div>
        ) : (
          <>
            {continueHeroItem && (
              <ContinueWatchingHero
                s={continueHeroItem}
                isMarking={markingNext.has(continueHeroItem.imdbId)}
                isDone={markedDone.has(continueHeroItem.imdbId)}
                onMarkNext={() => void handleMarkNext(continueHeroItem.imdbId)}
                onSelect={() => setSelectedItem(toSearchResult(continueHeroItem.imdbId, "series", continueHeroItem.name, { poster: continueHeroItem.poster, background: continueHeroItem.background }))}
              />
            )}
            {continueRowItems.length > 0 && (
              <CarouselTrack
                scrollRef={continueScroll.ref}
                canScrollLeft={continueScroll.canScrollLeft}
                canScrollRight={continueScroll.canScrollRight}
                className="gap-4"
              >
                {continueRowItems.map((s, index) => (
                  <ContinueWatchingCard
                    key={s.imdbId}
                    s={s}
                    eager={index < 4}
                    isMarking={markingNext.has(s.imdbId)}
                    isDone={markedDone.has(s.imdbId)}
                    onMarkNext={() => void handleMarkNext(s.imdbId)}
                    onSelect={() => setSelectedItem(toSearchResult(s.imdbId, "series", s.name, { poster: s.poster, background: s.background }))}
                  />
                ))}
              </CarouselTrack>
            )}
          </>
        )}
      </section>

      {/* ── Trending Now + Upcoming — two-column, breaks scroll monotony ── */}
      <div className={`grid gap-5 ${hasUpcoming ? "lg:grid-cols-[1fr_268px]" : ""}`}>
        <section>
          <SectionHeader title="Trending Now">
            <Link to="/search" className="text-sm font-medium text-claw-text underline-offset-2 transition-colors hover:underline">
              Search &rarr;
            </Link>
          </SectionHeader>
          {trendingLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton aspect-poster rounded-xl" />
              ))}
            </div>
          ) : trendingMovies.length === 0 ? (
            <div className="rounded-2xl py-12 text-center" style={{ border: "1px dashed var(--border-strong)" }}>
              <TrendingUp className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
              {trendingNeedsTmdb ? (
                <>
                  <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>
                    Trending needs a TMDB API key to fetch content.
                  </p>
                  <Link to="/settings?tab=integrations" className="mt-1 inline-block text-sm font-medium text-claw-text underline-offset-2 transition-colors hover:underline">
                    Set it up in Settings &rarr;
                  </Link>
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>
                    Unable to load trending content.
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadTrending()}
                    className="mt-1 rounded text-sm font-medium text-claw-text underline-offset-2 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
                  >
                    Retry
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {trendingMovies.slice(0, 4).map((item, index) => (
                <DiscoveryCard
                  key={item.id}
                  item={item}
                  eager={index < 4}
                  fill
                  onSelect={(i) => setSelectedItem(toSearchResult(i.id, (i.type ?? "movie") as "movie" | "series", i.name, { poster: i.poster, year: i.year, description: item.description, genres: i.genres, rating: i.rating }))}
                />
              ))}
            </div>
          )}
        </section>

        {hasUpcoming && (
          <section>
            <SectionHeader title="Upcoming" count={calendarEntries.length}>
              <Link to="/calendar" className="text-sm font-medium text-claw-text underline-offset-2 transition-colors hover:underline">
                Full calendar &rarr;
              </Link>
            </SectionHeader>
            {calendarLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton h-16 rounded-xl" />
                ))}
              </div>
            ) : calendarFailed ? (
              <SectionError message="Couldn't load upcoming episodes." onRetry={() => void loadCalendar()} />
            ) : (
              <div className="space-y-2">
                {calendarEntries.map((entry) => {
                  const [y, m, d] = entry.airDate.split("-").map(Number);
                  const airDate = new Date(y, m - 1, d);
                  const isToday = airDate.toDateString() === new Date().toDateString();
                  const tomorrow = new Date();
                  tomorrow.setDate(tomorrow.getDate() + 1);
                  const isTomorrow = airDate.toDateString() === tomorrow.toDateString();
                  const dateLabel = isToday ? "Today"
                    : isTomorrow ? "Tomorrow"
                    : airDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

                  return (
                    <div
                      key={`${entry.seriesImdbId}-s${entry.season}e${entry.episode}`}
                      className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 transition-all hover:border-[var(--border-strong)] hover:bg-[var(--surface-strong)]"
                    >
                      <div className="h-12 w-8 flex-none overflow-hidden rounded-md" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
                        <Poster src={entry.poster ?? undefined} alt={entry.seriesName} className="h-full w-full" sizes="32px" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold" style={{ color: "var(--text)" }}>
                          {entry.seriesName}
                        </p>
                        <p className="mt-0.5 truncate text-2xs" style={{ color: "var(--text-dim)" }}>
                          S{entry.season}:E{entry.episode}
                        </p>
                      </div>
                      <span
                        className={`flex-none rounded-full px-2 py-0.5 text-2xs font-semibold ${
                          isToday
                            ? "bg-claw-500/15 text-claw-text"
                            : isTomorrow
                              ? "bg-amber-500/15 text-amber-400"
                              : ""
                        }`}
                        style={!isToday && !isTomorrow ? { background: "var(--surface-strong)", color: "var(--text-dim)" } : undefined}
                      >
                        {dateLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {/* ── Discover: shared section for both recommendation rails ── */}
      {(recsLoading || recommendations.length > 0 || recsFailed || seriesRecsLoading || seriesRecs.length > 0 || seriesRecsFailed) && (
        <section>
          <SectionHeader title={aiActive ? "AI Picks" : "Discover"}>
            {aiActive && aiLastGeneratedAt && (() => {
              const nextRefresh = new Date(new Date(aiLastGeneratedAt).getTime() + 7 * 24 * 60 * 60 * 1000);
              const label = nextRefresh <= new Date() ? "Refresh due" : `Refreshes ${timeUntil(nextRefresh.toISOString())}`;
              return (
                <span title={`Next refresh: ${nextRefresh.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`} className="flex items-center gap-1 text-xs cursor-default" style={{ color: "var(--text-dim)" }}>
                  <Clock size={12} />
                  {label}
                </span>
              );
            })()}
          </SectionHeader>
          <div className="space-y-5">
            <DiscoverSubRow
              label="Movies"
              loading={recsLoading}
              failed={recsFailed}
              onRetry={() => void (aiActive ? loadRecs("movie") : loadAiSection())}
              items={recommendations}
              reasons={movieReasons}
              aiActive={aiActive}
              scroll={recsScroll}
              onSelect={(i) => setSelectedItem(toSearchResult(i.id, (i.type ?? "movie") as "movie" | "series", i.name, { poster: i.poster, year: i.year, description: i.description, genres: i.genres, rating: i.rating }))}
            />
            <DiscoverSubRow
              label="Series"
              loading={seriesRecsLoading}
              failed={seriesRecsFailed}
              onRetry={() => void (aiActive ? loadRecs("series") : loadAiSection())}
              items={seriesRecs}
              reasons={seriesReasons}
              aiActive={aiActive}
              scroll={seriesRecsScroll}
              onSelect={(i) => setSelectedItem(toSearchResult(i.id, "series", i.name, { poster: i.poster, year: i.year, description: i.description, genres: i.genres, rating: i.rating }))}
            />
          </div>
        </section>
      )}

      {/* ── Recently Watched ── */}
      <section>
        <SectionHeader title="Recently Watched" count={history.length}>
          {!loading && history.length > 0 && (
            <ScrollArrows
              canScrollLeft={recentScroll.canScrollLeft}
              canScrollRight={recentScroll.canScrollRight}
              onScroll={recentScroll.scroll}
            />
          )}
        </SectionHeader>
        {loading ? (
          <RecentlyWatchedSkeleton />
        ) : history.length === 0 ? (
          <div className="rounded-2xl py-12 text-center" style={{ border: "1px dashed var(--border-strong)" }}>
            <Film className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
            <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>
              No watch history yet. Anything you mark watched shows up here.
            </p>
            <Link to="/search" className="mt-1 inline-block text-sm font-medium text-claw-text underline-offset-2 transition-colors hover:underline">
              Find something to watch &rarr;
            </Link>
          </div>
        ) : (
          <CarouselTrack
            scrollRef={recentScroll.ref}
            canScrollLeft={recentScroll.canScrollLeft}
            canScrollRight={recentScroll.canScrollRight}
            className="gap-4"
          >
            {history.map((event) => (
              <div
                key={event.id}
                className="flex-none group relative rounded-xl"
                style={{ width: "11rem" }}
              >
                {/* Same treatment as DiscoveryCard: one real button covering a
                    card that has exactly one action. */}
                <button
                  type="button"
                  className="absolute inset-0 z-10 cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
                  onClick={() => setSelectedItem(toSearchResult(historyItemImdbId(event), event.type === "movie" ? "movie" : "series", event.name, { poster: event.poster }))}
                  aria-label={`View details for ${event.name}`}
                />
                <div
                  className="relative aspect-poster overflow-hidden rounded-xl shadow-lg transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-card-hover"
                  style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}
                >
                  <Poster src={event.poster} alt={event.name} className="h-full w-full" sizes="176px" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-3 pb-3 pt-12">
                    {event.type === "episode" && event.season != null && event.episode != null ? (
                      <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm" style={{ background: "var(--surface-strong)" }}>
                        S{event.season}:E{event.episode}
                      </span>
                    ) : event.type === "movie" ? (
                      <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-claw-300 backdrop-blur-sm bg-claw-500/20">
                        <Film className="h-3 w-3" /> Movie
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2.5 truncate text-sm font-semibold text-[var(--text)] transition-colors group-hover:text-claw-text">
                  {event.name}
                </p>
                <p className="text-2xs" style={{ color: "var(--text-dim)" }}>
                  {timeAgo(event.watchedAt)}
                </p>
              </div>
            ))}
          </CarouselTrack>
        )}
      </section>

      {/* ── Detail Panel ── */}
      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          history={panelHistory}
          historyLoading={panelHistoryLoading}
          detail={panelDetail}
          detailLoading={panelDetailLoading}
          onClose={() => { setSelectedItem(null); void refreshProgress(); }}
          onShowToast={showToast}
          onHistoryChange={(events) => setPanelHistory(events)}
          onSelectItem={setSelectedItem}
        />
      )}
    </div>
  );
}
