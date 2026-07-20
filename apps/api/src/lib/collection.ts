import { ListKind } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getDefaultProfileId } from "./profile.js";
import { findOrCreateTolerant } from "./prisma-tolerant.js";

export const ensureDefaultCollection = async () => {
  const profileId = await getDefaultProfileId();
  await findOrCreateTolerant(
    () => prisma.list.findFirst({ where: { kind: ListKind.collection, profileId } }),
    () => prisma.list.create({ data: { kind: ListKind.collection, name: "Collection", profileId } })
  );
};

export const getDefaultCollection = async (profileId?: string) => {
  const resolvedProfileId = profileId ?? (await getDefaultProfileId());

  return findOrCreateTolerant(
    () =>
      prisma.list.findFirst({
        where: { kind: ListKind.collection, profileId: resolvedProfileId },
        orderBy: { createdAt: "asc" },
      }),
    () =>
      prisma.list.create({
        data: { kind: ListKind.collection, name: "Collection", profileId: resolvedProfileId },
      })
  );
};
