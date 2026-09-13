import { Film } from "lucide-react";
import type { WatchEvent } from "../../api";
import { PosterCard } from "../PosterCard";
import { POSTER_CARD_SIZES } from "../Poster";
import { timeAgo } from "../../utils/timeAgo";
import { watchEventTitle } from "../../utils/watchEvents";

/** One watch in the Recently Watched rail: what it was, and how long ago. */
export function RecentlyWatchedCard({ event, onSelect }: { event: WatchEvent; onSelect: () => void }) {
  const title = watchEventTitle(event);
  return (
    <PosterCard
      poster={event.poster}
      name={title}
      onOpen={onSelect}
      sizes={POSTER_CARD_SIZES}
      className="w-poster-card flex-none"
      overlay={
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
      }
    >
      <p className="mt-2.5 truncate text-sm font-semibold text-[var(--text)] transition-colors group-hover:text-claw-text">
        {title}
      </p>
      <p className="meta-row" style={{ color: "var(--text-dim)" }}>
        {timeAgo(event.watchedAt)}
      </p>
    </PosterCard>
  );
}
