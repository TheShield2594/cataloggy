import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import type { SeriesProgressCandidate } from "./types.js";

export const isIncomingSeriesProgressNewer = (
  existing: SeriesProgressCandidate,
  incoming: SeriesProgressCandidate
): boolean => {
  const incomingTimestamp = incoming.lastWatchedAt.getTime();
  const existingTimestamp = existing.lastWatchedAt.getTime();

  if (incomingTimestamp !== existingTimestamp) return incomingTimestamp > existingTimestamp;
  if (incoming.lastSeason !== existing.lastSeason) return incoming.lastSeason > existing.lastSeason;
  return incoming.lastEpisode > existing.lastEpisode;
};

export const upsertSeriesProgressIfNewer = async (
  seriesImdbId: string,
  incoming: SeriesProgressCandidate
) => {
  const { count } = await prisma.seriesProgress.updateMany({
    where: {
      seriesImdbId,
      OR: [
        { lastWatchedAt: { lt: incoming.lastWatchedAt } },
        {
          lastWatchedAt: incoming.lastWatchedAt,
          lastSeason: { lt: incoming.lastSeason },
        },
        {
          lastWatchedAt: incoming.lastWatchedAt,
          lastSeason: incoming.lastSeason,
          lastEpisode: { lt: incoming.lastEpisode },
        },
      ],
    },
    data: {
      lastSeason: incoming.lastSeason,
      lastEpisode: incoming.lastEpisode,
      lastWatchedAt: incoming.lastWatchedAt,
      updatedAt: incoming.lastWatchedAt,
    },
  });

  if (count > 0) return;

  try {
    await prisma.seriesProgress.create({
      data: {
        seriesImdbId,
        lastSeason: incoming.lastSeason,
        lastEpisode: incoming.lastEpisode,
        lastWatchedAt: incoming.lastWatchedAt,
        updatedAt: incoming.lastWatchedAt,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
};
