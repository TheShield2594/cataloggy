import { ListKind } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getDefaultProfileId } from "./profile.js";
import { findOrCreateTolerant } from "./prisma-tolerant.js";

// Both lookups key on `kind` alone, the way the collection ones already do.
// Keying on the name as well meant a rename orphaned the default watchlist:
// `PATCH /lists/:id` renames it happily, the next lookup then found nothing
// called "Watchlist" and created a second one, and the Trakt mirror started
// writing to the empty list. The name is only ever a default for a row being
// created here.
export const ensureDefaultWatchlist = async () => {
  const profileId = await getDefaultProfileId();
  await findOrCreateTolerant(
    () => prisma.list.findFirst({ where: { kind: ListKind.watchlist, profileId } }),
    () => prisma.list.create({ data: { kind: ListKind.watchlist, name: "Watchlist", profileId } })
  );
};

export const getDefaultWatchlist = async (profileId?: string) => {
  const resolvedProfileId = profileId ?? (await getDefaultProfileId());

  return findOrCreateTolerant(
    () =>
      prisma.list.findFirst({
        where: { kind: ListKind.watchlist, profileId: resolvedProfileId },
        orderBy: { createdAt: "asc" },
      }),
    () =>
      prisma.list.create({
        data: { kind: ListKind.watchlist, name: "Watchlist", profileId: resolvedProfileId },
      })
  );
};
