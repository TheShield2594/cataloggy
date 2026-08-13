import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Envelope encryption for the credentials Cataloggy holds on your behalf: the
// Trakt access/refresh pair, a connected Stremio account's authKey, per-channel
// notification tokens, and the KV rows carrying the TMDB/OMDB/RPDB keys, the AI
// provider config (Authorization header and all) and the VAPID private key.
//
// The threat this addresses is a *copy of the database*: a dump on a NAS, the
// `pgdata` volume, a backup that outlived the machine it came from. Postgres is
// bound to loopback and every write path is behind `API_TOKEN`, so reading the
// database in the first place already takes host access — what this removes is
// the step from "has the file" to "has every credential in it".
//
// It is explicitly not protection from an attacker already running as the API
// process. The key derives from `API_TOKEN`, which that process must hold to
// serve a single request, so anything that can read the environment can read
// the secrets. Nothing here pretends otherwise; the property bought is that a
// dump on its own is inert.
//
// The key comes from `API_TOKEN` via HKDF-SHA256 — the same "derive from the
// one secret the deployment already has" shape as the Stremio addon secret
// (`lib/stremio-secret.ts`) and profile access tokens (`lib/profile-token.ts`),
// so it needs no extra configuration and no key file to lose. The cost, and it
// is a real one, is that rotating `API_TOKEN` makes every stored credential
// undecryptable: they have to be re-entered from Settings, not merely re-read.
// The startup pass in `lib/secret-migration.ts` says so in the log rather than
// leaving it to be discovered at the next sync.

/**
 * Marks a value as ciphertext, and versions the construction: a future change
 * of cipher or KDF gets its own scheme string so old rows stay readable.
 */
const SCHEME = "cgy1";

const HKDF_SALT = "cataloggy-secret-box-v1";
const HKDF_INFO = "cataloggy-secret-box";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Where a ciphertext is allowed to live, bound in as AES-GCM additional
 * authenticated data. A value lifted out of one column and pasted into another
 * fails to authenticate rather than decrypting into its new home.
 *
 * These strings are part of the on-disk format: changing one makes every value
 * stored under it undecryptable. Add, don't rename.
 */
export const SECRET_CONTEXT = {
  traktAccessToken: "traktToken.accessToken",
  traktRefreshToken: "traktToken.refreshToken",
  stremioAuthKey: "stremioAuth.authKey",
  notificationChannelToken: "notificationChannel.token",
} as const;

/** The context a KV row's value is encrypted under — its own key. */
export const kvSecretContext = (key: string): string => `kv:${key}`;

// Derivation is ~a hash, but it happens on every read of every credential, so
// the result is memoized against the token it came from — keyed rather than
// stored bare so a test (or a future in-process rotation) that changes
// `API_TOKEN` doesn't keep encrypting under the old one.
let cachedKey: { token: string; key: Buffer } | null = null;

const encryptionKey = (): Buffer | null => {
  const apiToken = process.env.API_TOKEN;
  if (!apiToken) return null;
  if (cachedKey?.token === apiToken) return cachedKey.key;

  const key = Buffer.from(hkdfSync("sha256", apiToken, HKDF_SALT, HKDF_INFO, KEY_BYTES));
  cachedKey = { token: apiToken, key };
  return key;
};

/**
 * Whether this process can encrypt at all. False only without `API_TOKEN`,
 * which production refuses to start without — so in practice this is "am I a
 * bare `pnpm dev` with no .env".
 */
export const isSecretEncryptionAvailable = (): boolean => !!process.env.API_TOKEN;

/**
 * Whether a stored value is one of ours. Structural only: a plaintext secret
 * that happened to look like this would fail authentication a moment later and
 * be reported as unreadable, which is the safe direction to be wrong in.
 */
export const isEncryptedSecret = (stored: string): boolean =>
  stored.startsWith(`${SCHEME}.`) && stored.split(".").length === 4;

/**
 * Ciphertext for `plaintext`, bound to `context`.
 *
 * Without `API_TOKEN` this returns the plaintext unchanged rather than throwing:
 * a development instance with no token still has to be able to save a TMDB key,
 * and `decryptSecret` reads such a value back. Production cannot reach this
 * branch — the startup guard exits before serving a request without a token.
 */
export const encryptSecret = (context: string, plaintext: string): string => {
  const key = encryptionKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [
    SCHEME,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
};

/**
 * The plaintext behind `stored`, or null when it cannot be recovered.
 *
 * A value that isn't ciphertext comes back verbatim: rows written before this
 * existed stay readable, so shipping the change needs no migration to be
 * correct (the startup pass encrypts them in place afterwards, for the rows a
 * dump would otherwise still expose).
 *
 * Null means the value is real ciphertext that this key cannot open — almost
 * always a rotated `API_TOKEN`. Callers treat that as "not configured" rather
 * than crashing, except where silently re-deriving would break something worse
 * (VAPID keys, whose loss unsubscribes every browser).
 */
export const decryptSecret = (context: string, stored: string): string | null => {
  if (!isEncryptedSecret(stored)) return stored;

  const key = encryptionKey();
  if (!key) return null;

  const [, ivRaw, tagRaw, ciphertextRaw] = stored.split(".");
  try {
    const iv = Buffer.from(ivRaw, "base64url");
    const tag = Buffer.from(tagRaw, "base64url");
    // createDecipheriv/setAuthTag throw on the wrong sizes; checking first keeps
    // a malformed row on the same "returns null" path as a wrong key.
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
};

/**
 * Re-encrypts `stored` under the current key if it is still plaintext, and
 * returns null when it is already ciphertext — so a caller walking rows can
 * write back exactly the ones that changed.
 */
export const encryptIfPlaintext = (context: string, stored: string): string | null =>
  isEncryptedSecret(stored) ? null : encryptSecret(context, stored);
