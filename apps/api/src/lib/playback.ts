import type { WatchEventType } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "./prisma.js";

/**
 * Resume points — Trakt's /sync/playback. One row per title per profile, moved
 * every time a player saves its position, and cleared once the title is watched.
 *
 * Episodes are identified by their series, the way `recordWatchEvent` stores
 * them: scrobble clients send either the episode's own id with `seriesImdbId`
 * beside it or the series id alone, and both have to land on the same row or a
 * resume point saved by one player would be invisible to the next.
 */

/** Twelve hours: longer than anything a player will report, finite so it cannot overflow an INTEGER column. */
export const MAX_PLAYBACK_SECONDS = 12 * 60 * 60;

export type PlaybackTarget = {
  type: WatchEventType;
  imdbId: string;
  seriesImdbId?: string | null | undefined;
  season?: number | null | undefined;
  episode?: number | null | undefined;
};

/**
 * For the two second fields, `undefined` means "not reported — keep what is
 * stored" and `null` means "clear it". A player that reports seconds on one
 * pause and nothing on the next must not lose the exact position it saved.
 */
export type PlaybackPosition = {
  progress?: number | null | undefined;
  positionSeconds?: number | null | undefined;
  durationSeconds?: number | null | undefined;
};

type ResolvedTarget = {
  key: string;
  type: WatchEventType;
  imdbId: string;
  season: number | null;
  episode: number | null;
};

/**
 * The row identity, or `null` for an episode with no season/episode number —
 * there is nothing to resume when the player cannot say which episode it was.
 */
export const resolvePlaybackTarget = (target: PlaybackTarget): ResolvedTarget | null => {
  if (target.type === "movie") {
    return { key: `movie:${target.imdbId}`, type: "movie", imdbId: target.imdbId, season: null, episode: null };
  }
  if (target.season == null || target.episode == null) return null;
  const imdbId = target.seriesImdbId || target.imdbId;
  return {
    key: `episode:${imdbId}:${target.season}:${target.episode}`,
    type: "episode",
    imdbId,
    season: target.season,
    episode: target.episode,
  };
};

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * A percentage from whatever the player reported. An explicit `progress` wins,
 * because that is what a Trakt-style client means by it; otherwise it is worked
 * out from the position, which is what a player that only knows seconds sends.
 */
export const resolveProgressPercent = (position: PlaybackPosition): number | null => {
  if (typeof position.progress === "number") return clampPercent(position.progress);
  const { positionSeconds, durationSeconds } = position;
  if (typeof positionSeconds === "number" && typeof durationSeconds === "number" && durationSeconds > 0) {
    return clampPercent((positionSeconds / durationSeconds) * 100);
  }
  return null;
};

/**
 * Saves (or moves) the resume point for a title. Returns `null` when there is
 * nothing to save: an episode with no numbers, or a position with neither a
 * percentage nor a position/duration pair to work one out from.
 */
export const savePlaybackProgress = async (
  profileId: string,
  target: PlaybackTarget,
  position: PlaybackPosition,
  pausedAt: Date = new Date()
) => {
  const resolved = resolvePlaybackTarget(target);
  const progress = resolveProgressPercent(position);
  if (!resolved || progress === null) return null;

  const data = {
    type: resolved.type,
    imdbId: resolved.imdbId,
    season: resolved.season,
    episode: resolved.episode,
    progress,
    pausedAt,
  };
  const { positionSeconds, durationSeconds } = position;
  return prisma.playbackProgress.upsert({
    where: { profileId_key: { profileId, key: resolved.key } },
    create: {
      profileId,
      key: resolved.key,
      ...data,
      positionSeconds: positionSeconds ?? null,
      durationSeconds: durationSeconds ?? null,
    },
    update: {
      ...data,
      ...(positionSeconds !== undefined ? { positionSeconds } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    },
  });
};

/**
 * Clears the resume point for a title once it has been watched.
 *
 * `watchedAt` bounds it: a watch recorded with an older date — a Trakt history
 * import, a backfilled "I saw this last year" — says nothing about the rewatch
 * the profile paused this evening, and must not throw that position away.
 *
 * Never throws. Recording the watch is what the caller came for; a resume point
 * that outlives it is a cosmetic leftover the next save or watch tidies up.
 */
export const clearPlaybackProgress = async (
  profileId: string,
  target: PlaybackTarget,
  watchedAt: Date,
  log?: FastifyBaseLogger
): Promise<void> => {
  const resolved = resolvePlaybackTarget(target);
  if (!resolved) return;
  try {
    await prisma.playbackProgress.deleteMany({
      where: { profileId, key: resolved.key, pausedAt: { lte: watchedAt } },
    });
  } catch (error) {
    log?.warn(error, "Failed to clear playback progress after a watch");
  }
};

export type PlaybackImportRow = {
  target: PlaybackTarget;
  progress: number;
  positionSeconds: number | null;
  durationSeconds: number | null;
  pausedAt: Date;
};

/** Upserts per transaction: enough to amortise the round trips, few enough to keep each one short. */
const IMPORT_CHUNK = 500;

/**
 * Restores resume points from a backup, and only forwards.
 *
 * The same rule as series progress, for the same reason: restoring last
 * month's file over a live profile must not rewind it. So a row is skipped
 * when the profile already holds a newer pause for that title, and when the
 * title has been watched at or after the pause — a resume point for something
 * finished since is the one thing worse than none, and recording that watch
 * is exactly what would have cleared it. The watch check sees the file's own
 * watch events too, because the caller imports those first.
 *
 * Within one file the newest pause per title wins, so a hand-edited backup
 * listing a title twice lands on one row rather than on whichever came last.
 * Returns how many points were written.
 */
export const importPlaybackProgress = async (profileId: string, rows: PlaybackImportRow[]): Promise<number> => {
  const byKey = new Map<string, { row: PlaybackImportRow; resolved: ResolvedTarget }>();
  for (const row of rows) {
    const resolved = resolvePlaybackTarget(row.target);
    if (!resolved) continue;
    const seen = byKey.get(resolved.key);
    if (!seen || seen.row.pausedAt < row.pausedAt) byKey.set(resolved.key, { row, resolved });
  }
  if (byKey.size === 0) return 0;

  const keys = [...byKey.keys()];
  const imdbIds = [...new Set([...byKey.values()].map(({ resolved }) => resolved.imdbId))];

  const [existing, watches] = await Promise.all([
    prisma.playbackProgress.findMany({
      where: { profileId, key: { in: keys } },
      select: { key: true, pausedAt: true },
    }),
    // Episodes are stored against the series, so `imdbId` matches both kinds.
    prisma.watchEvent.findMany({
      where: { profileId, imdbId: { in: imdbIds } },
      select: { type: true, imdbId: true, seriesImdbId: true, season: true, episode: true, watchedAt: true },
    }),
  ]);

  const pausedByKey = new Map(existing.map((row) => [row.key, row.pausedAt]));
  const lastWatchByKey = new Map<string, Date>();
  for (const watch of watches) {
    const key = resolvePlaybackTarget(watch)?.key;
    if (!key) continue;
    const latest = lastWatchByKey.get(key);
    if (!latest || latest < watch.watchedAt) lastWatchByKey.set(key, watch.watchedAt);
  }

  const writes = [...byKey.values()].filter(({ row, resolved }) => {
    const paused = pausedByKey.get(resolved.key);
    if (paused && paused >= row.pausedAt) return false;
    const watched = lastWatchByKey.get(resolved.key);
    return !(watched && watched >= row.pausedAt);
  });

  for (let i = 0; i < writes.length; i += IMPORT_CHUNK) {
    await prisma.$transaction(
      writes.slice(i, i + IMPORT_CHUNK).map(({ row, resolved }) => {
        const data = {
          type: resolved.type,
          imdbId: resolved.imdbId,
          season: resolved.season,
          episode: resolved.episode,
          progress: row.progress,
          positionSeconds: row.positionSeconds,
          durationSeconds: row.durationSeconds,
          pausedAt: row.pausedAt,
        };
        return prisma.playbackProgress.upsert({
          where: { profileId_key: { profileId, key: resolved.key } },
          create: { profileId, key: resolved.key, ...data },
          update: data,
        });
      })
    );
  }
  return writes.length;
};
