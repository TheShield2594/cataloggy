import { prisma } from "./prisma.js";
import { decryptSecret, encryptSecret, kvSecretContext } from "./secret-box.js";

// The KV table holds both preferences (language, region, watermarks, job runs)
// and credentials (API keys, the AI provider's Authorization header, the VAPID
// private key). Only the second group is encrypted, and routing every one of
// its reads and writes through this pair is what keeps that true — a new caller
// reaching for `prisma.kV` directly is then visibly not using the secret path.

export const readSecretKv = async (key: string): Promise<string | null> => {
  const row = await prisma.kV.findUnique({ where: { key } });
  if (!row) return null;
  return decryptSecret(kvSecretContext(key), row.value);
};

export const writeSecretKv = async (key: string, value: string): Promise<void> => {
  const stored = encryptSecret(kvSecretContext(key), value);
  const updatedAt = new Date();
  await prisma.kV.upsert({
    where: { key },
    create: { key, value: stored, updatedAt },
    update: { value: stored, updatedAt },
  });
};
