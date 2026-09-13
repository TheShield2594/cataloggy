import { Check, ChevronRight } from "lucide-react";
import type { SeriesProgress } from "../../api";
import { Poster } from "../Poster";
import { MICRO_LABEL } from "../typography";
import { computeProgressSummary, seasonCountSuffix } from "./series-progress";

/**
 * The scrim over a hero's backdrop: opaque under the text, clear over the art.
 *
 * Only painted when there is a real TMDB backdrop to darken. It used to be
 * unconditional, over a blurred copy of the poster when `background` was null —
 * and with no art behind it the ramp is just --bg-0 fading to the page, which
 * on the light theme runs cream to grey-brown across the half of the card
 * holding nothing and reads as a rendering fault rather than a choice. A hero
 * without a backdrop is a flat panel like every other one on the page instead.
 *
 * Shared with the Now Watching hero on the dashboard, which is the same
 * treatment applied to a check-in rather than to series progress.
 */
export const HERO_SCRIM =
  "linear-gradient(110deg, var(--bg-0) 15%, color-mix(in srgb, var(--bg-0) 35%, transparent) 60%, transparent)";

/** The first in-progress series, featured above the rail. */
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
  return (
    <div
      className="relative mb-3 flex flex-col gap-4 overflow-hidden rounded-2xl p-4 sm:flex-row sm:items-center"
      style={{
        minHeight: "10.5rem",
        border: "1px solid var(--border)",
        // No backdrop, no hero treatment — see HERO_SCRIM.
        ...(s.background ? null : { background: "var(--bg-1)" }),
      }}
    >
      {s.background && (
        <>
          <img
            src={s.background}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-60 scale-110"
          />
          <div className="absolute inset-0" style={{ background: HERO_SCRIM }} />
        </>
      )}
      <div className="relative z-10 h-40 w-28 flex-none overflow-hidden rounded-xl" style={{ boxShadow: "0 0 0 1px var(--border), var(--elevation-2)" }}>
        <Poster src={s.poster} alt={s.name} className="h-full w-full" eager sizes="112px" />
      </div>
      <div className="relative z-10 min-w-0 flex-1">
        <p className={`${MICRO_LABEL} text-claw-text`}>Series &middot; In Progress</p>
        <p className="mt-1 truncate font-heading text-xl font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{s.name}</p>
        <p className="meta-row mt-1" style={{ color: "var(--text-dim)" }}>
          S{s.lastSeason}:E{s.lastEpisode}
          {seasonCountSuffix(s.totalSeasons)}
        </p>
        {progress && (
          <div className="mt-3 max-w-xs">
            <div className="meta-row mb-1.5 flex items-center justify-between" style={{ color: "var(--text-mute)" }}>
              <span>{progress.label}</span>
              <span className="font-semibold text-claw-text">{progress.watched} / {progress.total} episodes</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-strong)" }}>
              <div className="h-full rounded-full bg-claw-500 transition-all duration-slow" style={{ width: `${progress.pct}%` }} />
            </div>
          </div>
        )}
      </div>
      {/* Out at the card's other edge, so the composition spans the width the
          card claims instead of stacking everything into the left third and
          leaving the rest to the backdrop. Below `sm` the row wraps to a column
          and these sit under the text, which is where they were. */}
      <div className="relative z-10 flex flex-none items-center gap-2">
        <button
          type="button"
          disabled={isMarking || isDone}
          onClick={onMarkNext}
          aria-label={isMarking ? "Marking" : isDone ? "Marked" : `Mark S${s.nextSeason}:E${s.nextEpisode}`}
          className="btn-primary"
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
          className="btn-secondary"
        >
          Details
        </button>
      </div>
    </div>
  );
}
