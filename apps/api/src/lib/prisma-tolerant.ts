import { Prisma } from "@prisma/client";

export const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

// Finds an existing row, or creates one if none exists yet. If a concurrent
// request wins a create-vs-create race (P2002), re-runs the lookup instead of
// throwing — the loser ends up returning the winner's row, like a real
// "find or create" would.
export async function findOrCreateTolerant<T>(
  find: () => Promise<T | null>,
  create: () => Promise<T>
): Promise<T> {
  const existing = await find();
  if (existing) return existing;

  try {
    return await create();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const retry = await find();
      if (retry) return retry;
    }
    throw error;
  }
}
