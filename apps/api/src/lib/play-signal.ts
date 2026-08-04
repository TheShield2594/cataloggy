import { MetadataType, WatchEventType } from "@prisma/client";
import type { PlaySignal } from "@prisma/client";
import { prisma } from "./prisma.js";
import { recordWatchEvent } from "./watch-event.js";
import type { FastifyBaseLogger } from "fastify";

/**
 * Turns "a client asked my addon about this title" into a watch, conservatively.
 *
 * The Stremio addon protocol never reports what was watched — a client only
 * ever *asks* an addon for things. But it asks in a way that leaks intent: a
 * `stream` request means the user opened a title's stream list, and a
 * `subtitles` request means a player actually loaded. That is the only
 * automatic signal available from clients that keep their library to
 * themselves (Vidi, Omni, Nuvio and other addon-consuming apps), which is why
 * this exists at all.
 *
 * It is inference, so the bias is deliberately toward missing a watch rather
 * than inventing one, and the whole thing is off unless explicitly enabled.
 */

/** A signal younger than this, superseded by a different title, was browsing. */
const BROWSE_WINDOW_MS = 2 * 60 * 1000;

/**
 * Fraction of the runtime that has to pass before a signal becomes a watch.
 * Matches SCROBBLE_COMPLETE_THRESHOLD so an inferred watch needs the same share
 * of the runtime a real scrobble does.
 */
const COMPLETION_FRACTION = 0.8;

// Used only when metadata carries no runtime. Chosen long rather than short:
// over-waiting loses a watch, under-waiting invents one.
const DEFAULT_MOVIE_RUNTIME_MIN = 100;
const DEFAULT_EPISODE_RUNTIME_MIN = 30;

/** Backstop for signals that somehow never settle — nothing should live this long. */
const MAX_PENDING_MS = 24 * 60 * 60 * 1000;

export const PLAY_SIGNAL_SOURCE = "Stremio addon";

export type PlaySignalResource = "stream" | "subtitles";

export const isPlayDetectionEnabled = (): boolean =>
  process.env.STREMIO_PLAY_DETECTION?.trim() === "true";

export type RecordPlaySignalParams = {
  type: WatchEventType;
  imdbId: string;
  seriesImdbId?: string | null;
  season?: number | null;
  episode?: number | null;
  resource: PlaySignalResource;
  client?: string | null;
  profileId: string;
  log: FastifyBaseLogger;
};

/** Stable identity for a pending signal — see the `key` column's comment. */
const signalKey = (
  type: WatchEventType,
  imdbId: string,
  season: number | null,
  episode: number | null
): string => (type === WatchEventType.episode ? `episode:${imdbId}:${season}:${episode}` : `movie:${imdbId}`);

const runtimeMsFor = async (type: WatchEventType, imdbId: string): Promise<number> => {
  const metaType = type === "movie" ? MetadataType.movie : MetadataType.series;
  const meta = await prisma.metadata
    .findUnique({ where: { imdbId_type: { imdbId, type: metaType } }, select: { runtime: true } })
    .catch(() => null);

  const fallback = type === "movie" ? DEFAULT_MOVIE_RUNTIME_MIN : DEFAULT_EPISODE_RUNTIME_MIN;
  const minutes = meta?.runtime && meta.runtime > 0 ? meta.runtime : fallback;
  return minutes * 60 * 1000;
};

/** True when `next` comes after `previous` in the same series. */
const isLaterEpisode = (
  previous: Pick<PlaySignal, "season" | "episode">,
  next: { season?: number | null; episode?: number | null }
): boolean => {
  const pSeason = previous.season ?? 0;
  const pEpisode = previous.episode ?? 0;
  const nSeason = next.season ?? 0;
  const nEpisode = next.episode ?? 0;
  return nSeason > pSeason || (nSeason === pSeason && nEpisode > pEpisode);
};

const settleSignal = async (signal: PlaySignal, log: FastifyBaseLogger, reason: string): Promise<boolean> => {
  try {
    await recordWatchEvent({
      type: signal.type,
      imdbId: signal.imdbId,
      seriesImdbId: signal.type === WatchEventType.episode ? signal.imdbId : undefined,
      season: signal.season,
      episode: signal.episode,
      watchedAt: signal.lastSeenAt,
      source: PLAY_SIGNAL_SOURCE,
      profileId: signal.profileId,
      log,
    });
  } catch (error) {
    // Keep the row so the next settle pass retries it rather than losing the
    // watch to one bad write.
    log.warn({ error, imdbId: signal.imdbId }, "Failed to record an inferred watch from a play signal");
    return false;
  }

  await prisma.playSignal.deleteMany({ where: { id: signal.id } });
  log.info(
    { imdbId: signal.imdbId, season: signal.season, episode: signal.episode, reason },
    "Play signal settled as watched"
  );
  return true;
};

/**
 * Records that a client asked about a title.
 *
 * A repeat request for the title already pending just refreshes it. A request
 * for a *different* title is what resolves the pending ones: anything only
 * moments old was browsing and is dropped, while the previous episode of the
 * same series is settled immediately — moving on to the next episode is the
 * strongest completion evidence this protocol can offer.
 */
export const recordPlaySignal = async (
  params: RecordPlaySignalParams
): Promise<{ status: "opened" | "refreshed" | "disabled" }> => {
  if (!isPlayDetectionEnabled()) return { status: "disabled" };

  const { type, resource, client, profileId, log } = params;
  const imdbId = type === WatchEventType.episode ? (params.seriesImdbId ?? params.imdbId) : params.imdbId;
  const season = type === WatchEventType.episode ? (params.season ?? null) : null;
  const episode = type === WatchEventType.episode ? (params.episode ?? null) : null;
  const now = new Date();

  const key = signalKey(type, imdbId, season, episode);

  const existing = await prisma.playSignal.findUnique({
    where: { profileId_key: { profileId, key } },
  });

  if (existing) {
    await prisma.playSignal.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
    return { status: "refreshed" };
  }

  const others = await prisma.playSignal.findMany({ where: { profileId } });
  for (const other of others) {
    const age = now.getTime() - other.firstSeenAt.getTime();
    if (age < BROWSE_WINDOW_MS) {
      await prisma.playSignal.deleteMany({ where: { id: other.id } });
      log.info(
        { imdbId: other.imdbId, season: other.season, episode: other.episode },
        "Play signal discarded as browsing — superseded before it could plausibly have been watched"
      );
      continue;
    }

    if (
      other.type === WatchEventType.episode &&
      type === WatchEventType.episode &&
      other.imdbId === imdbId &&
      isLaterEpisode(other, { season, episode })
    ) {
      await settleSignal(other, log, "next episode started");
    }
  }

  const dueAt = new Date(now.getTime() + (await runtimeMsFor(type, imdbId)) * COMPLETION_FRACTION);

  await prisma.playSignal.create({
    data: {
      key,
      type,
      imdbId,
      season,
      episode,
      resource,
      client: client?.slice(0, 200) ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      dueAt,
      profileId,
    },
  });

  return { status: "opened" };
};

/**
 * Promotes signals that have outlived their title's runtime without being
 * contradicted, and clears anything left stranded. Runs on a timer.
 */
export const settleDuePlaySignals = async (
  log: FastifyBaseLogger
): Promise<{ settled: number; expired: number }> => {
  const now = new Date();
  let settled = 0;

  const due = await prisma.playSignal.findMany({ where: { dueAt: { lte: now } } });
  for (const signal of due) {
    if (await settleSignal(signal, log, "runtime elapsed")) settled += 1;
  }

  const { count: expired } = await prisma.playSignal.deleteMany({
    where: { firstSeenAt: { lt: new Date(now.getTime() - MAX_PENDING_MS) } },
  });

  return { settled, expired };
};

/** Diagnostics: what the addon has seen but not yet acted on. */
export const getPendingPlaySignals = async (profileId: string): Promise<PlaySignal[]> =>
  prisma.playSignal.findMany({ where: { profileId }, orderBy: { lastSeenAt: "desc" }, take: 50 });
