import type { FastifyBaseLogger } from "fastify";
import { prisma } from "./prisma.js";
import {
  SECRET_CONTEXT,
  decryptSecret,
  encryptIfPlaintext,
  isEncryptedSecret,
  isSecretEncryptionAvailable,
  kvSecretContext,
} from "./secret-box.js";
import { TMDB_API_KEY_KV } from "./tmdb-client.js";
import { OMDB_API_KEY_KV } from "./omdb.js";
import { RPDB_API_KEY_KV } from "./rpdb.js";
import { AI_CONFIG_KEY } from "./ai.js";
import { VAPID_KEYS_KV } from "./push.js";

// `decryptSecret` reads a plaintext row back unchanged, so the app is correct
// the moment it deploys — but a row nobody re-saves stays plaintext forever,
// and a plaintext row in a dump is exactly what this was for. So every boot
// sweeps the credential-bearing rows and encrypts the ones still in the clear.
//
// It doubles as the one place a rotated API_TOKEN gets named out loud. Every
// read path degrades quietly on its own (an undecryptable key reads as "not
// configured"), which is right at request time and useless as a diagnosis —
// the operator would see integrations drop one at a time with no common cause.
// One startup error naming every affected credential is that cause.

/** KV rows that hold a credential rather than a preference. */
const SECRET_KV_KEYS = [
  TMDB_API_KEY_KV,
  OMDB_API_KEY_KV,
  RPDB_API_KEY_KV,
  AI_CONFIG_KEY,
  VAPID_KEYS_KV,
] as const;

type Sweep = { encrypted: number; unreadable: string[] };

/**
 * Encrypts still-plaintext credentials in place and reports any that the
 * current key cannot open. Never throws: a deployment with an unreadable
 * credential has to keep starting, since re-entering it means reaching the
 * Settings page this would otherwise have blocked.
 */
export const encryptStoredSecrets = async (logger: FastifyBaseLogger): Promise<Sweep> => {
  const sweep: Sweep = { encrypted: 0, unreadable: [] };

  if (!isSecretEncryptionAvailable()) {
    logger.warn(
      "API_TOKEN is not set, so stored credentials (API keys, Trakt/Stremio tokens) are being kept in plaintext"
    );
    return sweep;
  }

  /** One column's worth of work: encrypt if plaintext, flag if unopenable. */
  const visit = async (
    context: string,
    label: string,
    stored: string,
    persist: (value: string) => Promise<unknown>
  ): Promise<void> => {
    if (isEncryptedSecret(stored)) {
      if (decryptSecret(context, stored) === null) sweep.unreadable.push(label);
      return;
    }
    await persist(encryptIfPlaintext(context, stored)!);
    sweep.encrypted += 1;
  };

  const kvRows = await prisma.kV.findMany({ where: { key: { in: [...SECRET_KV_KEYS] } } });
  for (const row of kvRows) {
    await visit(kvSecretContext(row.key), row.key, row.value, (value) =>
      prisma.kV.update({ where: { key: row.key }, data: { value, updatedAt: new Date() } })
    );
  }

  for (const token of await prisma.traktToken.findMany()) {
    await visit(SECRET_CONTEXT.traktAccessToken, "Trakt access token", token.accessToken, (value) =>
      prisma.traktToken.update({ where: { id: token.id }, data: { accessToken: value } })
    );
    await visit(SECRET_CONTEXT.traktRefreshToken, "Trakt refresh token", token.refreshToken, (value) =>
      prisma.traktToken.update({ where: { id: token.id }, data: { refreshToken: value } })
    );
  }

  for (const auth of await prisma.stremioAuth.findMany()) {
    await visit(SECRET_CONTEXT.stremioAuthKey, "Stremio access key", auth.authKey, (value) =>
      prisma.stremioAuth.update({ where: { id: auth.id }, data: { authKey: value } })
    );
  }

  const channels = await prisma.notificationChannel.findMany({ where: { NOT: { token: null } } });
  for (const channel of channels) {
    await visit(
      SECRET_CONTEXT.notificationChannelToken,
      `Notification channel token (${channel.name})`,
      channel.token!,
      (value) => prisma.notificationChannel.update({ where: { id: channel.id }, data: { token: value } })
    );
  }

  if (sweep.encrypted > 0) {
    logger.info(
      { count: sweep.encrypted },
      "Encrypted stored credentials that were still in plaintext from before encryption at rest"
    );
  }

  if (sweep.unreadable.length > 0) {
    logger.error(
      { credentials: sweep.unreadable },
      `${sweep.unreadable.length} stored credential(s) cannot be decrypted, which means API_TOKEN has changed since they were saved. ` +
        "Restore the previous API_TOKEN, or re-enter these from Settings — they are unusable until you do."
    );
  }

  return sweep;
};
