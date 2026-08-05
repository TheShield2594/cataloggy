import { api, WatchEvent } from "../api";

/**
 * Re-creates a watch event that was just deleted, for the Undo on the removal
 * toast. The server mints a fresh row rather than resurrecting the old one, so
 * the restored event carries a new id — callers swapping it back into local
 * state must use the returned object, not the one they optimistically dropped,
 * or the next delete will 404.
 *
 * Same-day identical plays are deduped server-side into a play count, so the
 * returned id can also belong to an event the caller is already rendering.
 */
export async function relogWatchEvent(event: WatchEvent): Promise<WatchEvent> {
  const { watchEvent } = await api.logWatch({
    type: event.type,
    imdbId: event.imdbId,
    seriesImdbId: event.seriesImdbId,
    season: event.season,
    episode: event.episode,
    watchedAt: event.watchedAt,
    dateUnknown: event.dateUnknown,
    // Carried across so Undo restores the whole row: the note lives on the
    // event, and the server mints a new one rather than resurrecting the old.
    note: event.note ?? null,
  });
  return { ...event, id: watchEvent.id };
}
