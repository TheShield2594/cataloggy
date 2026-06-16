import { ListKind, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export const ensureDefaultWatchlist = async () => {
  await prisma.$transaction(
    async (tx) => {
      const defaultWatchlists = await tx.list.findMany({
        where: { kind: ListKind.watchlist, name: "Watchlist" },
        orderBy: { createdAt: "asc" },
      });

      if (defaultWatchlists.length === 0) {
        await tx.list.create({ data: { kind: ListKind.watchlist, name: "Watchlist" } });
        return;
      }

      if (defaultWatchlists.length > 1) {
        const [, ...duplicates] = defaultWatchlists;
        await tx.list.deleteMany({ where: { id: { in: duplicates.map((l) => l.id) } } });
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
};

export const getDefaultWatchlist = async () => {
  const watchlist = await prisma.list.findFirst({
    where: { kind: ListKind.watchlist, name: "Watchlist" },
    orderBy: { createdAt: "asc" },
  });

  if (watchlist) return watchlist;

  return prisma.list.create({ data: { kind: ListKind.watchlist, name: "Watchlist" } });
};
