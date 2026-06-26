import { ListKind, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getDefaultProfileId } from "./profile.js";

export const ensureDefaultCollection = async () => {
  const profileId = await getDefaultProfileId();
  const existing = await prisma.list.findFirst({
    where: { kind: ListKind.collection, profileId },
  });
  if (existing) return;

  try {
    await prisma.list.create({ data: { kind: ListKind.collection, name: "Collection", profileId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // race condition — another instance created it first
      return;
    }
    throw error;
  }
};

export const getDefaultCollection = async (profileId?: string) => {
  const resolvedProfileId = profileId ?? (await getDefaultProfileId());

  const collection = await prisma.list.findFirst({
    where: { kind: ListKind.collection, profileId: resolvedProfileId },
    orderBy: { createdAt: "asc" },
  });

  if (collection) return collection;

  try {
    return await prisma.list.create({
      data: { kind: ListKind.collection, name: "Collection", profileId: resolvedProfileId },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const retry = await prisma.list.findFirst({
        where: { kind: ListKind.collection, profileId: resolvedProfileId },
        orderBy: { createdAt: "asc" },
      });
      if (retry) return retry;
    }
    throw error;
  }
};
