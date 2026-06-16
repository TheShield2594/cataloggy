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
  const existing = await prisma.seriesProgress.findUnique({
    where: { seriesImdbId },
    select: { lastSeason: true, lastEpisode: true, lastWatchedAt: true },
  });

  if (!existing) {
    await prisma.seriesProgress.create({
      data: {
        seriesImdbId,
        lastSeason: incoming.lastSeason,
        lastEpisode: incoming.lastEpisode,
        lastWatchedAt: incoming.lastWatchedAt,
        updatedAt: incoming.lastWatchedAt,
      },
    });
    return;
  }

  if (!isIncomingSeriesProgressNewer(existing, incoming)) return;

  await prisma.seriesProgress.update({
    where: { seriesImdbId },
    data: {
      lastSeason: incoming.lastSeason,
      lastEpisode: incoming.lastEpisode,
      lastWatchedAt: incoming.lastWatchedAt,
      updatedAt: incoming.lastWatchedAt,
    },
  });
};
