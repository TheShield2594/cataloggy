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

export type PlaybackTarget = {
  type: WatchEventType;
  imdbId: string;
  seriesImdbId?: string | null | undefined;
  season?: number | null | undefined;
  episode?: number | null | undefined;
};

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
    positionSeconds: position.positionSeconds ?? null,
    durationSeconds: position.durationSeconds ?? null,
    pausedAt,
  };
  return prisma.playbackProgress.upsert({
    where: { profileId_key: { profileId, key: resolved.key } },
    create: { profileId, key: resolved.key, ...data },
    update: data,
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
