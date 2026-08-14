import { WatchEventType } from "@prisma/client";
import type { Prisma } from "@prisma/client";

// One statement of the rule that decides whether two watches are the same watch.
//
// It used to be stated four times — once in `recordWatchEvent`, once in the Trakt
// history import, once in the Trakt watched-list gap-fill, once in the batch
// importer — and the four disagreed, which is how the same play could land as two
// rows depending on which door it came through. It is now also stated a fifth time,
// in SQL, as the `watchevent_dedup_key` unique index (migration 20260814120000).
// That one is the authority; everything here exists so the lookups the code does
// beforehand agree with the judgement the database will make.
//
// This module deliberately imports nothing from the app: `watch-event.ts` and
// `trakt-client.ts` already import each other, and hanging the key off either of
// them would close that cycle.

/**
 * The UTC-day window a watch is deduped within, as a Prisma range filter.
 *
 * A day rather than an instant because that is what the app has always done:
 * `recordWatchEvent` folds a same-day rewatch into `plays` and moves `watchedAt`
 * within the day. Two writers recording one play rarely agree on the timestamp to
 * the millisecond — a Plex and a Jellyfin webhook for the same episode are seconds
 * apart — so an instant would not have caught them.
 */
export const watchEventDayWindow = (watchedAt: Date): { gte: Date; lte: Date } => {
  const gte = new Date(watchedAt);
  gte.setUTCHours(0, 0, 0, 0);
  const lte = new Date(watchedAt);
  lte.setUTCHours(23, 59, 59, 999);
  return { gte, lte };
};

export type WatchEventDedupKey = {
  profileId: string;
  type: WatchEventType;
  /** For episodes the series' imdbId; for movies the film's. Matches what every path writes. */
  imdbId: string;
  season?: number | null;
  episode?: number | null;
  watchedAt: Date;
};

/**
 * The `where` that finds the row `watchevent_dedup_key` would collide with.
 *
 * Episodes match on `seriesImdbId` and movies on `imdbId`, mirroring the index's
 * `COALESCE("seriesImdbId", "imdbId")` — every write path mirrors the series id into
 * `imdbId` for episodes, so the two agree on which column carries the identity.
 */
export const watchEventDedupWhere = (key: WatchEventDedupKey): Prisma.WatchEventWhereInput =>
  key.type === WatchEventType.episode
    ? {
        profileId: key.profileId,
        type: WatchEventType.episode,
        seriesImdbId: key.imdbId,
        season: key.season ?? null,
        episode: key.episode ?? null,
        watchedAt: watchEventDayWindow(key.watchedAt),
      }
    : {
        profileId: key.profileId,
        type: WatchEventType.movie,
        imdbId: key.imdbId,
        watchedAt: watchEventDayWindow(key.watchedAt),
      };
