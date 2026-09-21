import { Check, ChevronRight } from "lucide-react";
import type { SeriesProgress } from "../../api";
import { Poster } from "../Poster";
import { MICRO_LABEL, PAGE_TITLE } from "../typography";
import { computeProgressSummary, seasonCountSuffix } from "./series-progress";

/**
 * The scrim over a hero's backdrop: solid under the text, clear over the art.
 *
 * Bottom-up rather than diagonal, because the cinematic hero anchors its title
 * and actions at the bottom edge over a full-bleed backdrop — the streaming
 * treatment, where the art fills the card and the words sit in a well of shade
 * that rises from the floor of it. The bottom ~fifth resolves to a solid --bg-0
 * so the card melts into the page below it rather than ending on a hard line,
 * the same "content continues under this" move the tab bar and sheets make.
 *
 * Only painted when there is a real TMDB backdrop to darken. It used to be
 * unconditional, over a blurred copy of the poster when `background` was null —
 * and with no art behind it the ramp is just --bg-0 fading to the page, which
 * on the light theme runs cream to grey-brown across the card holding nothing
 * and reads as a rendering fault rather than a choice. A hero without a
 * backdrop is a flat panel like every other one on the page instead.
 *
 * It fades to --bg-0 (the page colour) and the text over it is --text, so the
 * pairing is legible on every theme without the scrim naming a colour of its
 * own: black text in a light well on the light theme, white in a dark one on
 * the dark themes.
 *
 * Shared with the Now Watching hero on the dashboard, which is the same
 * treatment applied to a check-in rather than to series progress.
 */
export const HERO_SCRIM =
  "linear-gradient(to top, var(--bg-0) 6%, color-mix(in srgb, var(--bg-0) 82%, transparent) 30%, color-mix(in srgb, var(--bg-0) 30%, transparent) 58%, transparent 88%)";

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

  // The kicker, the title, the S:E line, the progress meter and the two actions
  // — the same content in the cinematic and the flat layout, so the branch
  // below is only ever choosing where to stand it, never what to say.
  const kicker = <p className={`${MICRO_LABEL} text-claw-text`}>Series &middot; In Progress</p>;
  const meta = (
    <p className="meta-row mt-1" style={{ color: "var(--text-dim)" }}>
      S{s.lastSeason}:E{s.lastEpisode}
      {seasonCountSuffix(s.totalSeasons)}
    </p>
  );
  const meter = progress && (
    <div className="mt-3 max-w-sm">
      <div className="meta-row mb-1.5 flex items-center justify-between" style={{ color: "var(--text-mute)" }}>
        <span>{progress.label}</span>
        <span className="font-semibold text-claw-text">{progress.watched} / {progress.total} episodes</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-strong)" }}>
        <div className="h-full rounded-full bg-claw-500 transition-[width] duration-slow" style={{ width: `${progress.pct}%` }} />
      </div>
    </div>
  );
  const actions = (
    <div className="relative z-10 mt-4 flex flex-none items-center gap-2">
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
      <button type="button" onClick={onSelect} className="btn-secondary">
        Details
      </button>
    </div>
  );

  // No backdrop, no hero treatment — see HERO_SCRIM. Falls back to the flat
  // panel it always was: a small poster carrying the identity the missing
  // backdrop can't, text and actions beside it.
  if (!s.background) {
    return (
      <div
        className="relative mb-3 flex flex-col gap-4 overflow-hidden rounded-3xl p-4 sm:flex-row sm:items-center"
        style={{ minHeight: "10.5rem", border: "1px solid var(--border)", background: "var(--bg-1)" }}
      >
        <div className="h-40 w-28 flex-none overflow-hidden rounded-xl" style={{ boxShadow: "0 0 0 1px var(--border), var(--elevation-2)" }}>
          <Poster src={s.poster} alt={s.name} className="h-full w-full" eager sizes="112px" />
        </div>
        <div className="min-w-0 flex-1">
          {kicker}
          <h2 className="mt-1 truncate font-heading text-xl font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{s.name}</h2>
          {meta}
          {meter}
        </div>
        {actions}
      </div>
    );
  }

  // The cinematic hero: the backdrop fills the card, and the text sits in the
  // well the scrim rises from at the bottom. Taller than the flat panel — the
  // art is the point, so it gets room to be an image rather than a strip behind
  // a paragraph — and the title steps up to the page's large title over it.
  return (
    <section
      className="relative mb-3 flex flex-col justify-end overflow-hidden rounded-3xl p-5 sm:p-6"
      style={{ minHeight: "19rem", border: "1px solid var(--border)" }}
    >
      <img
        src={s.background}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0" style={{ background: HERO_SCRIM }} />
      <div className="relative z-10 min-w-0">
        {kicker}
        {/* A heading, not a styled paragraph — like NowWatchingHero, so a
            screen-reader user navigating by heading lands on the hero's title
            rather than skipping past the largest thing on the card. */}
        <h2 className={`mt-1 truncate ${PAGE_TITLE}`} style={{ color: "var(--text)" }}>{s.name}</h2>
        {meta}
        {meter}
      </div>
      {actions}
    </section>
  );
}
