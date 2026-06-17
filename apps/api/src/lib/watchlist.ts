import { ListKind, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export const ensureDefaultWatchlist = async () => {
  const existing = await prisma.list.findFirst({
    where: { kind: ListKind.watchlist, name: "Watchlist" },
  });
  if (existing) return;

  try {
    await prisma.list.create({ data: { kind: ListKind.watchlist, name: "Watchlist" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // race condition — another instance created it first
      return;
    }
    throw error;
  }
};

export const getDefaultWatchlist = async () => {
  const watchlist = await prisma.list.findFirst({
    where: { kind: ListKind.watchlist, name: "Watchlist" },
    orderBy: { createdAt: "asc" },
  });

  if (watchlist) return watchlist;

  return prisma.list.create({ data: { kind: ListKind.watchlist, name: "Watchlist" } });
};
