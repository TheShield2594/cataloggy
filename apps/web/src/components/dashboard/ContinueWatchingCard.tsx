import { Check, ChevronRight } from "lucide-react";
import type { SeriesProgress } from "../../api";
import { Poster, POSTER_CARD_SIZES } from "../Poster";
import { computeProgressPct, seasonCountSuffix } from "./series-progress";

/**
 * One in-progress series in the Continue Watching rail.
 *
 * Not a `PosterCard`: that frame is one action under one full-card button, and
 * this card has two — open the series, or mark the next episode — so the poster
 * is a backdrop with both controls laid over it instead.
 */
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
    <div role="group" aria-label={s.name} className="group w-poster-card flex-none">
      <div
        className="poster-frame relative aspect-poster overflow-hidden rounded-xl"
      >
        <Poster src={s.poster} alt={s.name} className="absolute inset-0 h-full w-full" eager={eager} sizes={POSTER_CARD_SIZES} />
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
                <div className="h-full rounded-full bg-claw-500 transition-all duration-slow" style={{ width: `${progressPct}%` }} />
              </div>
            )}
            <p className="meta-row text-white/75">
              S{s.lastSeason}:E{s.lastEpisode}
              {seasonCountSuffix(s.totalSeasons)}
            </p>
            <button
              type="button"
              disabled={isMarking || isDone}
              onClick={onMarkNext}
              aria-label={isMarking ? "Marking" : isDone ? "Marked" : `Mark S${s.nextSeason}:E${s.nextEpisode}`}
              className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all duration-base active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-claw-300 ${
                isMarking ? "bg-white/10 text-white/50" : isDone ? "bg-emerald-500/20 text-success" : "bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
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
        <p className="meta-row" style={{ color: "var(--text-dim)" }}>
          {s.watchedEpisodes} of {s.totalEpisodes} episodes
        </p>
      )}
    </div>
  );
}
