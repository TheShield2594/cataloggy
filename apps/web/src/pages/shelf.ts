import type { CheckIn, Game, ListItemWithMeta, SearchResult, SeriesProgress } from "../api";
import { formatPlaytime } from "../utils/playtime";

/*
 * The Shelf's data model: one row shape for everything the app tracks.
 *
 * Lists, Games and History were three destinations holding one idea — things
 * you are keeping track of — split by the storage they happened to land in. A
 * show in a list and a game in the library are the same kind of object to the
 * person looking at them, and the tabs were a filter wearing a costume.
 *
 * Unifying them is only an improvement if it costs no precision, which is the
 * whole reason this file exists rather than a `toCard()` in the page. A show is
 * counted in episodes, a game in hours, a film in one number and nothing else.
 * Every builder below produces the same `ShelfEntry`, but each one fills
 * `meta`, `ruler` and `trailing` in its own unit — one grid, three rulers.
 *
 * Kept out of ShelfPage.tsx so the unit choices can be tested as facts rather
 * than asserted against rendered markup.
 */

/** Books are in the redesign but not in the schema, so there are three. */
export type ShelfKind = "show" | "film" | "game";

export type ShelfFilter = "all" | ShelfKind;

export const SHELF_FILTERS: readonly { value: ShelfFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "show", label: "Shows" },
  { value: "film", label: "Films" },
  { value: "game", label: "Games" },
] as const;

/** What `<ProgressRuler>` needs, or null where the kind has no total to measure. */
export type ShelfRuler = {
  value: number;
  total: number;
  partial?: number;
  discrete: boolean;
  label: string;
};

export type ShelfEntry = {
  /** Unique across kinds — a game and a film could otherwise collide on an id. */
  key: string;
  kind: ShelfKind;
  title: string;
  /** Poster or cover art. Null is normal; the Poster component draws initials. */
  art: string | null;
  /**
   * When this landed on the shelf, in epoch ms, for the default sort. `null`
   * for a row whose timestamp is unparseable, which sorts to the bottom rather
   * than to 1970.
   */
  addedAt: number | null;
  /** The mono run under the title — "Show · S3 E4 of 8". Rendered uppercase. */
  meta: string;
  ruler: ShelfRuler | null;
  /** The right-hand mono value on an in-progress row — "42 min left", "18.4 h". */
  trailing: string | null;
  /** Set on game rows, so the page knows to open the game panel instead. */
  game?: Game;
  /** Set on show and film rows, so the page can open the media detail panel. */
  item?: SearchResult;
};

const KIND_LABEL: Record<ShelfKind, string> = { show: "Show", film: "Film", game: "Game" };

/** Joined with the separator the whole redesign uses for metadata runs. */
export const metaLine = (...parts: (string | null | undefined | false)[]): string =>
  parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" · ");

/**
 * An ISO timestamp as epoch ms, or null when it is missing or unparseable.
 *
 * Null rather than `NaN`, because `NaN` compares false against everything and
 * would sort a broken row to wherever the comparator happened to leave it —
 * `buildShelf` files a null deliberately, at the end.
 */
const parseTime = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

// Metadata rows are backfilled in the background, so an item can arrive with no
// metadata at all. The title captured when it was added stands in before the
// bare IMDb id, which is never what anyone is looking for. Same fallback chain
// the Lists page uses, so a row reads identically on both surfaces.
const listItemName = (item: ListItemWithMeta): string =>
  item.metadata?.name ?? item.title ?? item.imdbId;

/**
 * The `SearchResult` the media detail panel opens with. The panel refetches
 * everything it actually needs, so this only has to be accurate about identity
 * and good enough to paint the first frame.
 */
function listItemToSearchResult(item: ListItemWithMeta): SearchResult {
  return {
    imdbId: item.imdbId,
    type: item.type,
    name: listItemName(item),
    year: item.metadata?.year ?? null,
    poster: item.metadata?.poster ?? null,
    description: null,
    genres: item.metadata?.genres ?? [],
    rating: item.metadata?.rating ?? null,
    // Membership is what the Shelf is built out of, but which list a title is
    // in is not something the row shows — the panel refetches it on open.
    inWatchlist: false,
    inCollection: false,
    lists: [],
  };
}

/**
 * A shelf row for a title in a list — a show or a film, depending on its type.
 *
 * This is the shape most of the grid is made of, and the one that knows the
 * least: a list row carries a title, a year and a poster, and nothing about how
 * far into it you are.
 */
export function shelfEntryFromListItem(item: ListItemWithMeta): ShelfEntry {
  const kind: ShelfKind = item.type === "series" ? "show" : "film";
  const year = item.metadata?.year;
  return {
    key: `${item.type}:${item.imdbId}`,
    kind,
    title: listItemName(item),
    art: item.metadata?.poster ?? null,
    addedAt: parseTime(item.addedAt),
    meta: metaLine(KIND_LABEL[kind], year ? String(year) : null),
    // A list row knows nothing about how far in you are — that lives in the
    // series progress feed, which the in-progress block above the grid reads.
    // Drawing an empty track here would say "not started" about a show you are
    // four episodes into.
    ruler: null,
    trailing: null,
    item: listItemToSearchResult(item),
  };
}

/**
 * A shelf row for a game, measured in hours rather than in parts.
 *
 * A finished game says so instead of showing a total that has stopped moving,
 * which is the only completion signal the schema has.
 */
export function shelfEntryFromGame(game: Game): ShelfEntry {
  return {
    key: `game:${game.id}`,
    kind: "game",
    title: game.title,
    art: game.coverUrl,
    addedAt: parseTime(game.createdAt),
    meta: metaLine(
      KIND_LABEL.game,
      game.finished ? "Finished" : formatPlaytime(game.playtimeMinutes, "Unplayed")
    ),
    // Hours have no denominator. A game's playtime is a running total, not a
    // fraction of anything the app knows, so it gets a number and no bar —
    // which is the point of per-kind units rather than a shortcoming of them.
    ruler: null,
    trailing: null,
    game,
  };
}

/**
 * How far into the episode or film currently checked in, 0–1, or null.
 *
 * The check-in carries a start and an expiry stamped from the runtime, so the
 * elapsed fraction between them is the only partial-play signal the app has. It
 * is what part-fills the tick for the episode in flight, and what turns the
 * row's trailing value from a count into "42 min left".
 *
 * Read at call time rather than on a timer: the Shelf remounts on navigation
 * and refetches on focus, and a minute-by-minute re-render of the whole grid to
 * keep one number exact is a poor trade. It can therefore be a few minutes
 * stale on a tab left open, which is why it is only ever shown rounded.
 */
export function checkinProgress(checkin: CheckIn | null, now = Date.now()): number | null {
  if (!checkin?.expiresAt) return null;
  const start = parseTime(checkin.startedAt);
  const end = parseTime(checkin.expiresAt);
  if (start === null || end === null || end <= start) return null;
  return Math.min(Math.max((now - start) / (end - start), 0), 1);
}

/** Whole minutes left in the checked-in title, floored at zero, or null. */
export function checkinMinutesLeft(checkin: CheckIn | null, now = Date.now()): number | null {
  if (!checkin?.expiresAt) return null;
  const end = parseTime(checkin.expiresAt);
  if (end === null) return null;
  return Math.max(Math.round((end - now) / 60_000), 0);
}

/** The title a check-in is against: the series for an episode, the film itself. */
export const checkinTitleId = (checkin: CheckIn | null): string | null =>
  checkin ? (checkin.type === "episode" ? (checkin.seriesImdbId ?? checkin.imdbId) : checkin.imdbId) : null;

/**
 * An in-progress show row.
 *
 * The ruler measures the season the viewer is actually in whenever TMDB knows
 * how long it is, because that is the number next to the `S3 E4` in the same
 * row. Series-wide totals are the fallback and are labelled as such — a bar
 * called "season progress" filled from a series total is what made a show four
 * episodes into season one of three read as barely started.
 */
export function shelfEntryFromSeriesProgress(s: SeriesProgress, checkin: CheckIn | null, now = Date.now()): ShelfEntry {
  const isCheckedIn = checkinTitleId(checkin) === s.imdbId;
  const partial = isCheckedIn ? (checkinProgress(checkin, now) ?? 0) : 0;
  const minutesLeft = isCheckedIn ? checkinMinutesLeft(checkin, now) : null;

  /*
   * `seasonTotalEpisodes` and `seasonWatchedEpisodes` both describe
   * `lastSeason` — the season the last watch was in — and the API moves
   * `nextSeason` on once that season is finished. So the two only describe the
   * episode you are about to watch while both are the same season.
   *
   * Past that boundary they are a season you have completed and left: pairing
   * them with the next episode gives "S4 E1 of 8" where the 8 is season three's
   * length, under a ruler showing a full 8 of 8. The series-wide totals are
   * right there and actually answer the question, so they take over.
   */
  const seasonKnown =
    s.nextSeason === s.lastSeason &&
    typeof s.seasonWatchedEpisodes === "number" &&
    typeof s.seasonTotalEpisodes === "number" &&
    s.seasonTotalEpisodes > 0;
  const seriesKnown = typeof s.watchedEpisodes === "number" && !!s.totalEpisodes && s.totalEpisodes > 0;

  let ruler: ShelfRuler | null = null;
  if (seasonKnown) {
    ruler = {
      value: s.seasonWatchedEpisodes!,
      total: s.seasonTotalEpisodes!,
      partial,
      discrete: true,
      label: `Season ${s.lastSeason}: ${s.seasonWatchedEpisodes} of ${s.seasonTotalEpisodes} episodes watched`,
    };
  } else if (seriesKnown) {
    ruler = {
      value: s.watchedEpisodes!,
      total: s.totalEpisodes!,
      partial,
      discrete: true,
      label: `${s.watchedEpisodes} of ${s.totalEpisodes} episodes watched`,
    };
  }

  const episodeOfSeason = seasonKnown
    ? `S${s.nextSeason} E${s.nextEpisode} of ${s.seasonTotalEpisodes}`
    : `S${s.nextSeason} E${s.nextEpisode}`;

  return {
    key: `series:${s.imdbId}`,
    kind: "show",
    title: s.name,
    art: s.poster ?? null,
    // In-progress rows are ordered by how far along they are, not by when they
    // were added, so this is unused for them — and inventing a timestamp the
    // feed doesn't carry would be worse than admitting there isn't one.
    addedAt: null,
    meta: metaLine(KIND_LABEL.show, episodeOfSeason),
    ruler,
    trailing:
      minutesLeft !== null
        ? `${minutesLeft} min left`
        : seasonKnown
          ? `${s.seasonWatchedEpisodes}/${s.seasonTotalEpisodes} ep`
          : seriesKnown
            ? `${s.watchedEpisodes}/${s.totalEpisodes} ep`
            : null,
    item: {
      imdbId: s.imdbId,
      type: "series",
      name: s.name,
      year: null,
      poster: s.poster ?? null,
      description: null,
      genres: [],
      rating: null,
      inWatchlist: false,
      inCollection: false,
      lists: [],
      background: s.background ?? null,
    },
  };
}

/** An in-progress game row: hours played, where it was last touched, no bar. */
export function shelfEntryFromGameInProgress(game: Game, timeAgo: (iso: string) => string): ShelfEntry {
  const base = shelfEntryFromGame(game);
  return {
    ...base,
    meta: metaLine(KIND_LABEL.game, game.lastPlayedAt ? `Played ${timeAgo(game.lastPlayedAt)}` : null),
    trailing: formatPlaytime(game.playtimeMinutes, "Unplayed"),
  };
}

/**
 * Started but not finished — which for a game is the only thing the schema can
 * say. There is no chapter count and no completion percentage, so "in progress"
 * is "has been played and hasn't been marked done", and the row shows hours
 * rather than pretending to a fraction.
 */
export const isGameInProgress = (game: Game): boolean => !game.finished && game.playtimeMinutes > 0;

/**
 * The union, deduplicated and ordered.
 *
 * A title in three lists is one thing on a shelf, so the same `type:imdbId`
 * collapses to a single entry — the earliest-added one wins, because that is
 * when it actually arrived, whatever a later list says. Rows with no usable
 * timestamp sort last rather than to the epoch, which would file every
 * metadata-less import above everything the user added deliberately.
 */
export function buildShelf(items: ListItemWithMeta[], games: Game[]): ShelfEntry[] {
  const byKey = new Map<string, ShelfEntry>();

  for (const item of items) {
    const entry = shelfEntryFromListItem(item);
    const existing = byKey.get(entry.key);
    if (!existing) {
      byKey.set(entry.key, entry);
      continue;
    }
    if (existing.addedAt === null || (entry.addedAt !== null && entry.addedAt < existing.addedAt)) {
      byKey.set(entry.key, entry);
    }
  }

  for (const game of games) {
    const entry = shelfEntryFromGame(game);
    byKey.set(entry.key, entry);
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.addedAt === b.addedAt) return a.title.localeCompare(b.title);
    if (a.addedAt === null) return 1;
    if (b.addedAt === null) return -1;
    return b.addedAt - a.addedAt;
  });
}

/** How many entries each filter would show, for the counts on the filter row. */
export function countByKind(entries: ShelfEntry[]): Record<ShelfFilter, number> {
  const counts: Record<ShelfFilter, number> = { all: entries.length, show: 0, film: 0, game: 0 };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}

/** Narrows to one kind. `all` is the identity, and returns the same array. */
export const applyShelfFilter = (entries: ShelfEntry[], filter: ShelfFilter): ShelfEntry[] =>
  filter === "all" ? entries : entries.filter((entry) => entry.kind === filter);

/**
 * The line under the page title: what is on the shelf, and how recently any of
 * it moved.
 *
 * "3 kinds" counts the kinds actually present, not the three the app supports —
 * a library with no games says "2 kinds", because the third is a claim about
 * this shelf rather than about the schema.
 */
export function shelfSummary(entries: ShelfEntry[], lastActivity: string | null): string {
  const kinds = new Set(entries.map((entry) => entry.kind)).size;
  return metaLine(
    `${entries.length} ${entries.length === 1 ? "title" : "titles"}`,
    kinds > 0 ? `${kinds} ${kinds === 1 ? "kind" : "kinds"}` : null,
    lastActivity
  );
}
