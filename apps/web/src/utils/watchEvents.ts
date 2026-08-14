import { api, WatchEvent } from "../api";

/**
 * What a row's controls call the thing they act on.
 *
 * The visible row says the title once and the episode number beside it, in two
 * separate elements; a label built from `event.name` alone would give three
 * buttons in a row the same name on a series the user watched twice in a day.
 * The episode number is what tells those rows apart, so it belongs in the name.
 *
 * Shared rather than page-local because the detail panel lists the same events
 * with the same controls, and had labelled every one of its delete buttons
 * "Remove watch event" — one name for every row in the list.
 */
export function watchEventLabel(event: WatchEvent): string {
  const name = event.name || "this watch";
  return event.type === "episode" && event.season != null && event.episode != null
    ? `${name} S${event.season}E${event.episode}`
    : name;
}

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
