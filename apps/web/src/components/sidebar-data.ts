import type { CatalogList } from "../api";
import type { SectionHealth } from "./settings/health";

/*
 * What the rail shows besides routes.
 *
 * A source list on the platform is not a menu of pages — it is the app's own
 * contents in the chrome: your lists by name with how many are in each, and
 * your sources with whether they are working. The rail had neither, which is
 * why it was six links and a column of empty space.
 *
 * The choices live here rather than in the markup because they are facts about
 * the data, not about the layout: which colour a list gets and which sources
 * are worth a row are both things worth asserting in a test.
 */

/**
 * The dot beside a list name.
 *
 * Identity, not status — it says *which list*, the way a calendar's colour
 * does, so it comes from the system tint palette rather than from the
 * --status-* trio, which means "working or not" and must not be borrowed for
 * something that is neither.
 */
/*
 * Green and blue are deliberately absent: they are the watchlist's and the
 * collection's, and a custom list that drew one of them would be claiming to be
 * a built-in. Orange is the app's accent and red is what a fault looks like, so
 * neither is a list's identity either. What's left is five that can't be
 * mistaken for anything.
 */
// Non-empty by type, so the modulo below has something to fall back to.
export const LIST_TINTS: [string, ...string[]] = [
  "var(--tint-purple)",
  "var(--tint-pink)",
  "var(--tint-indigo)",
  "var(--tint-cyan)",
  "var(--tint-teal)",
] as const;

/**
 * A list's colour: fixed for the two lists every profile has, hashed for the
 * rest.
 *
 * The watchlist and the collection are the same two things on every install and
 * are worth being recognisable across them. A custom list has no colour in the
 * schema, so its dot is derived from its id — which means it is stable across
 * sessions, devices and renames, and two lists are unlikely to collide. Hashing
 * the *id* rather than the name is the whole point: a renamed list keeps its
 * dot, because it is the same list.
 *
 * Same hash as `getGradient` in carousel-utils, for the same reason: a stable
 * pick out of a small palette, with no state to store.
 */
export function listTint(list: CatalogList): string {
  if (list.kind === "watchlist") return "var(--tint-green)";
  if (list.kind === "collection") return "var(--tint-blue)";
  let hash = 0;
  for (let i = 0; i < list.id.length; i++) hash = (hash * 31 + list.id.charCodeAt(i)) | 0;
  return LIST_TINTS[Math.abs(hash) % LIST_TINTS.length] ?? LIST_TINTS[0];
}

/**
 * The rail's list order: the watchlist, the collection, then everything else by
 * name.
 *
 * Not the order the API returns them in. The two built-in lists are the ones a
 * reader is looking for, and a custom list appearing above them because it was
 * created first is the kind of ordering that makes a source list feel like a
 * dump of rows.
 */
const KIND_RANK: Record<CatalogList["kind"], number> = { watchlist: 0, collection: 1, custom: 2 };

export function orderListsForRail(lists: CatalogList[]): CatalogList[] {
  return [...lists].sort(
    (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name)
  );
}

/**
 * The sources the rail can put a row against, in the order it shows them.
 *
 * Keyed by the id of the Settings section each one belongs to, because that is
 * what `useSettingsHealth` reports under and where the row navigates to. The
 * names are shortened from the section titles — a rail row is 220px wide and
 * "Stremio Watched Sync" is a heading, not a label.
 *
 * `job-status` is deliberately absent. It is health, and it is the one entry
 * that is about this server's own scheduled work rather than about a source;
 * the Settings page leads with it, and the rail would be claiming the server is
 * a place your history comes from.
 */
export const RAIL_SOURCES: readonly { id: string; label: string }[] = [
  { id: "trakt", label: "Trakt" },
  { id: "stremio-sync", label: "Stremio" },
  { id: "tmdb", label: "TMDB" },
  { id: "omdb", label: "OMDb" },
  { id: "rpdb", label: "RPDB" },
] as const;

export type RailSource = {
  id: string;
  label: string;
  health: SectionHealth;
  /** What the row actually prints: `short` where the mapper set one. */
  status: string;
};

/**
 * The source rows to draw: the ones that are actually set up.
 *
 * A source nobody has configured is doing exactly what it was asked to, and a
 * rail listing five of them as "Not set" is a permanent to-do list in the
 * chrome of every screen. `idle` is precisely that state — see the four-tone
 * note in settings/health.ts — so it is the line between a row and no row.
 *
 * A source whose status request *failed* has no entry at all and is likewise
 * absent, which is the same distinction the Settings page draws: we could not
 * ask is not the same answer as it is not set up, and neither is worth a dot.
 */
export function railSources(health: Record<string, SectionHealth>): RailSource[] {
  return RAIL_SOURCES.flatMap((source) => {
    const entry = health[source.id];
    if (!entry || entry.tone === "idle") return [];
    return [{ ...source, health: entry, status: entry.short ?? entry.label }];
  });
}
