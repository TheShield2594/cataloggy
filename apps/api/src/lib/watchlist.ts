import { ListKind } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getDefaultProfileId } from "./profile.js";
import { findOrCreateTolerant } from "./prisma-tolerant.js";

export const ensureDefaultWatchlist = async () => {
  const profileId = await getDefaultProfileId();
  await findOrCreateTolerant(
    () => prisma.list.findFirst({ where: { kind: ListKind.watchlist, name: "Watchlist", profileId } }),
    () => prisma.list.create({ data: { kind: ListKind.watchlist, name: "Watchlist", profileId } })
  );
};

export const getDefaultWatchlist = async (profileId?: string) => {
  const resolvedProfileId = profileId ?? (await getDefaultProfileId());

  return findOrCreateTolerant(
    () =>
      prisma.list.findFirst({
        where: { kind: ListKind.watchlist, name: "Watchlist", profileId: resolvedProfileId },
        orderBy: { createdAt: "asc" },
      }),
    () =>
      prisma.list.create({
        data: { kind: ListKind.watchlist, name: "Watchlist", profileId: resolvedProfileId },
      })
  );
};
