import { prisma } from "./prisma.js";

export const droppedSeriesKey = (profileId: string, imdbId: string) =>
  `dropped:series:${profileId}:${imdbId}`;

export const getDroppedSeriesIds = async (
  profileId: string,
  imdbIds: string[]
): Promise<Set<string>> => {
  if (imdbIds.length === 0) return new Set();

  const rows = await prisma.kV.findMany({
    where: { key: { in: imdbIds.map((id) => droppedSeriesKey(profileId, id)) } },
    select: { key: true },
  });

  const prefixLength = droppedSeriesKey(profileId, "").length;
  return new Set(rows.map((row) => row.key.slice(prefixLength)));
};
