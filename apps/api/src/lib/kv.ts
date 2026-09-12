import { prisma } from "./prisma.js";
import { kvCache, kvLookups } from "./cache.js";

// The one read path for the KV table, so that caching it is a property of the
// table rather than of each caller remembering. `lib/settings.ts` and
// `lib/secret-store.ts` both go through here; a new caller reaching for
// `prisma.kV.findUnique` directly is visibly not sharing the cache.
//
// What is cached is the *stored* string, not the decrypted one — for the
// credential keys that means ciphertext, and the plaintext is re-derived per
// read. That costs a few microseconds of AES on a short string and keeps the
// process's long-lived structures free of bare credentials, which is the same
// direction `lib/secret-box.ts` leans everywhere else.

/**
 * A KV row's stored value, or null when there is no such row.
 *
 * Read-through with single-flight: a cache hit returns immediately, a miss with
 * a read already in flight joins it, and only the first caller of a cold key
 * queries. "No row" is cached too — on a fresh install the language and region
 * keys do not exist, and those are read on every request.
 */
export const readKv = async (key: string): Promise<string | null> => {
  const cached = kvCache.get(key);
  if (cached) return cached.value;

  const inFlight = kvLookups.get(key);
  if (inFlight) return inFlight;

  const lookup: Promise<string | null> = prisma.kV
    .findUnique({ where: { key } })
    .then((row) => {
      const value = row?.value ?? null;
      // Only cache when this is still the registered lookup. If it is not, a
      // write invalidated the key while this read was in flight, so what it
      // found is already stale — caching it would put the pre-write value back
      // for a whole TTL. The caller still gets the value it read.
      if (kvLookups.get(key) === lookup) kvCache.set(key, { value });
      return value;
    })
    .finally(() => {
      // Same guard: a newer lookup may already hold the slot.
      if (kvLookups.get(key) === lookup) kvLookups.delete(key);
    });

  kvLookups.set(key, lookup);
  return lookup;
};

/**
 * Drops a key's cached value so the next read sees the write that just
 * happened. Every writer calls this; the TTL is only the backstop for a write
 * made by some other process.
 *
 * The in-flight entry is dropped as well: a read that started before the write
 * may resolve after it, and leaving it would let it cache the pre-write value.
 */
export const invalidateKv = (key: string): void => {
  kvCache.delete(key);
  kvLookups.delete(key);
};

/** Writes a non-credential KV row and invalidates its cached value. */
export const writeKv = async (key: string, value: string): Promise<void> => {
  const updatedAt = new Date();
  await prisma.kV.upsert({
    where: { key },
    create: { key, value, updatedAt },
    update: { value, updatedAt },
  });
  invalidateKv(key);
};

/** Deletes a KV row if present and invalidates its cached value. */
export const deleteKv = async (key: string): Promise<void> => {
  await prisma.kV.deleteMany({ where: { key } });
  invalidateKv(key);
};
