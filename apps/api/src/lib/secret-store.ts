import { prisma } from "./prisma.js";
import { deleteKv, invalidateKv, readKv } from "./kv.js";
import { decryptSecret, encryptSecret, kvSecretContext } from "./secret-box.js";

// The KV table holds both preferences (language, region, watermarks, job runs)
// and credentials (API keys, the AI provider's Authorization header, the VAPID
// private key). Only the second group is encrypted, and routing every one of
// its reads and writes through this pair is what keeps that true — a new caller
// reaching for `prisma.kV` directly is then visibly not using the secret path.
//
// Reads go through `lib/kv.js`, which caches the stored value briefly; every
// writer here invalidates, so a key saved from Settings is in use on the next
// request rather than up to a TTL later.

export const readSecretKv = async (key: string): Promise<string | null> => {
  // `readKv` caches the stored ciphertext, not what comes out of it, so the
  // decrypt happens per read. That is the point: the cache exists to spare the
  // database round trip on paths like `getTmdb()`, not to keep credentials
  // decrypted in a long-lived map.
  const stored = await readKv(key);
  if (stored === null) return null;
  return decryptSecret(kvSecretContext(key), stored);
};

export const writeSecretKv = async (key: string, value: string): Promise<void> => {
  const stored = encryptSecret(kvSecretContext(key), value);
  const updatedAt = new Date();
  await prisma.kV.upsert({
    where: { key },
    create: { key, value: stored, updatedAt },
    update: { value: stored, updatedAt },
  });
  invalidateKv(key);
};

/** Removes a stored credential, e.g. when Settings clears a saved API key. */
export const deleteSecretKv = (key: string): Promise<void> => deleteKv(key);
