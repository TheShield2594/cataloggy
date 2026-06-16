import { ItemType } from "@prisma/client";
import { TraktClient, computeTokenExpiresAt } from "../trakt.js";
import { prisma } from "./prisma.js";
import { upsertSeriesProgressIfNewer } from "./series-progress.js";
import type { SeriesProgressCandidate } from "./types.js";
import type { FastifyRequest } from "fastify";

export { computeTokenExpiresAt };

let traktClient: TraktClient | null = null;

export const getTraktClient = async (): Promise<TraktClient> => {
  if (!traktClient) {
    traktClient = await TraktClient.create(prisma);
  }
  return traktClient;
};

export const resetTraktClient = () => {
  traktClient = null;
};

export const TRAKT_LAST_POLLED_AT_KEY = "trakt:lastPolledAt";

const getTraktPollStartAt = async (): Promise<Date> => {
  const kvValue = await prisma.kV.findUnique({ where: { key: TRAKT_LAST_POLLED_AT_KEY } });

  if (!kvValue) return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const parsed = new Date(kvValue.value);
  if (Number.isNaN(parsed.getTime())) return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return parsed;
};

export const pollTraktHistory = async (logger: FastifyRequest["log"]) => {
  const client = await getTraktClient();
  const pollStartAt = await getTraktPollStartAt();
  const pollCompletedAt = new Date();
  const pollStartAtIso = pollStartAt.toISOString();

  const [movieHistory, episodeHistory] = await Promise.all([
    client.fetchMovieHistory(logger, pollStartAtIso),
    client.fetchEpisodeHistory(logger, pollStartAtIso),
  ]);

  const importedWatchEvents = { movies: 0, episodes: 0 };
  const seriesProgressByImdb = new Map<string, SeriesProgressCandidate>();

  for (const entry of movieHistory) {
    const imdbId = entry.movie?.ids?.imdb;
    const watchedAt = entry.watched_at;
    if (!imdbId || !watchedAt) continue;

    const watchedAtDate = new Date(watchedAt);
    const title = entry.movie?.title?.trim();
    if (title) {
      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.movie, imdbId } },
        create: { type: ItemType.movie, imdbId, title },
        update: { title },
      });
    }

    const existingEvent = await prisma.watchEvent.findFirst({
      where: { type: "movie", imdbId, watchedAt: watchedAtDate },
    });

    if (existingEvent) {
      await prisma.watchEvent.update({ where: { id: existingEvent.id }, data: { plays: 1 } });
    } else {
      await prisma.watchEvent.create({
        data: { type: "movie", imdbId, watchedAt: watchedAtDate, plays: 1 },
      });
    }

    importedWatchEvents.movies += 1;
  }

  for (const entry of episodeHistory) {
    const episodeImdbId = entry.episode?.ids?.imdb;
    const seriesImdbId = entry.show?.ids?.imdb;
    const watchedAt = entry.watched_at;
    const season = entry.episode?.season;
    const episode = entry.episode?.number;

    if (!episodeImdbId || !seriesImdbId || !watchedAt || season === undefined || episode === undefined) continue;

    const watchedAtDate = new Date(watchedAt);
    const seriesTitle = entry.show?.title?.trim();
    if (seriesTitle) {
      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.series, imdbId: seriesImdbId } },
        create: { type: ItemType.series, imdbId: seriesImdbId, title: seriesTitle },
        update: { title: seriesTitle },
      });
    }

    const existingEvent = await prisma.watchEvent.findFirst({
      where: { type: "episode", imdbId: episodeImdbId, seriesImdbId, season, episode, watchedAt: watchedAtDate },
    });

    if (existingEvent) {
      await prisma.watchEvent.update({ where: { id: existingEvent.id }, data: { plays: 1 } });
    } else {
      await prisma.watchEvent.create({
        data: {
          type: "episode",
          imdbId: episodeImdbId,
          seriesImdbId,
          season,
          episode,
          watchedAt: watchedAtDate,
          plays: 1,
        },
      });
    }

    const existing = seriesProgressByImdb.get(seriesImdbId);
    if (
      !existing ||
      watchedAtDate.getTime() > existing.lastWatchedAt.getTime() ||
      (watchedAtDate.getTime() === existing.lastWatchedAt.getTime() &&
        (season > existing.lastSeason ||
          (season === existing.lastSeason && episode > existing.lastEpisode)))
    ) {
      seriesProgressByImdb.set(seriesImdbId, {
        lastSeason: season,
        lastEpisode: episode,
        lastWatchedAt: watchedAtDate,
      });
    }

    importedWatchEvents.episodes += 1;
  }

  for (const [seriesImdbId, progress] of seriesProgressByImdb.entries()) {
    await upsertSeriesProgressIfNewer(seriesImdbId, progress);
  }

  await prisma.kV.upsert({
    where: { key: TRAKT_LAST_POLLED_AT_KEY },
    create: {
      key: TRAKT_LAST_POLLED_AT_KEY,
      value: pollCompletedAt.toISOString(),
      updatedAt: pollCompletedAt,
    },
    update: {
      value: pollCompletedAt.toISOString(),
      updatedAt: pollCompletedAt,
    },
  });

  return {
    since: pollStartAtIso,
    polledAt: pollCompletedAt.toISOString(),
    importedWatchEvents,
    updatedSeriesProgress: seriesProgressByImdb.size,
  };
};
