import { ListKind, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getDefaultProfileId } from "./profile.js";

export const ensureDefaultWatchlist = async () => {
  const profileId = await getDefaultProfileId();
  const existing = await prisma.list.findFirst({
    where: { kind: ListKind.watchlist, name: "Watchlist", profileId },
  });
  if (existing) return;

  try {
    await prisma.list.create({ data: { kind: ListKind.watchlist, name: "Watchlist", profileId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // race condition — another instance created it first
      return;
    }
    throw error;
  }
};

export const getDefaultWatchlist = async (profileId?: string) => {
  const resolvedProfileId = profileId ?? (await getDefaultProfileId());

  const watchlist = await prisma.list.findFirst({
    where: { kind: ListKind.watchlist, name: "Watchlist", profileId: resolvedProfileId },
    orderBy: { createdAt: "asc" },
  });

  if (watchlist) return watchlist;

  return prisma.list.create({
    data: { kind: ListKind.watchlist, name: "Watchlist", profileId: resolvedProfileId },
  });
};
