import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

/**
 * scrypt parameters. N=16384/r=8/p=1 is the widely used interactive-login
 * baseline: ~16 MB of memory and a few tens of milliseconds per derivation,
 * which is nothing for the handful of PIN checks a household makes and a wall
 * for the offline guessing a leaked database enables. `maxmem` has to be
 * raised past Node's 32 MB default because it accounts for scratch space
 * beyond the 128*N*r the parameters themselves need.
 */
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const SALT_BYTES = 16;

const SCRYPT_PREFIX = "scrypt";
/** A PIN hashed before salted KDFs: 64 hex characters of unsalted SHA-256. */
const LEGACY_SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Shortest PIN accepted. Four digits is what the UI's keypad asks for and what
 * a lock screen conditions people to expect; the point of the floor is to stop
 * a one- or two-character PIN, which the 5-attempt lockout alone barely slows.
 */
export const MIN_PIN_LENGTH = 4;
/** Guard against a "PIN" long enough to make scrypt itself the attack. */
export const MAX_PIN_LENGTH = 128;

export const pinLengthError = `PIN must be between ${MIN_PIN_LENGTH} and ${MAX_PIN_LENGTH} characters`;

export const isValidPinFormat = (pin: string): boolean =>
  pin.length >= MIN_PIN_LENGTH && pin.length <= MAX_PIN_LENGTH;

/**
 * Encoded as `scrypt$N$r$p$<salt-hex>$<key-hex>` so the cost parameters travel
 * with the hash: raising them later re-verifies old PINs against the values
 * they were created with, instead of silently locking everyone out.
 */
export const hashPin = async (pin: string): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(pin, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [SCRYPT_PREFIX, SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("hex"), key.toString("hex")].join("$");
};

const legacyMatches = (pin: string, pinHash: string): boolean => {
  const incoming = createHash("sha256").update(pin).digest();
  const expected = Buffer.from(pinHash, "hex");
  if (incoming.length !== expected.length) return false;
  return timingSafeEqual(incoming, expected);
};

const scryptMatches = async (pin: string, pinHash: string): Promise<boolean> => {
  const [, rawN, rawR, rawP, saltHex, keyHex] = pinHash.split("$");
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (!/^[0-9a-f]+$/.test(saltHex ?? "") || !/^[0-9a-f]+$/.test(keyHex ?? "")) return false;

  const expected = Buffer.from(keyHex, "hex");
  const key = await scryptAsync(pin, Buffer.from(saltHex, "hex"), expected.length, {
    N,
    r,
    p,
    maxmem: SCRYPT_MAXMEM,
  });
  return timingSafeEqual(key, expected);
};

/**
 * Constant-time within a scheme. Accepts both the current scrypt encoding and
 * the unsalted SHA-256 hashes written before it, so an existing PIN keeps
 * working across the upgrade — see `needsRehash`.
 */
export const pinMatches = async (pin: string, pinHash: string): Promise<boolean> => {
  if (pinHash.startsWith(`${SCRYPT_PREFIX}$`)) {
    try {
      return await scryptMatches(pin, pinHash);
    } catch {
      // Malformed/unsupported parameters — no PIN can match, and a stored hash
      // we can't parse must not throw its way into a 500.
      return false;
    }
  }
  if (LEGACY_SHA256_PATTERN.test(pinHash)) return legacyMatches(pin, pinHash);
  return false;
};

/**
 * True for a stored hash that verified but wasn't produced by the current
 * configuration — a legacy SHA-256 digest, or scrypt at cost parameters we've
 * since moved off. The caller re-hashes the PIN it just proved and writes it
 * back, so old hashes disappear on first use rather than needing every
 * household to re-enter their PIN. This is what makes raising the parameters
 * above a one-line change.
 */
export const needsRehash = (pinHash: string): boolean => {
  if (!pinHash.startsWith(`${SCRYPT_PREFIX}$`)) return true;
  const [, rawN, rawR, rawP] = pinHash.split("$");
  // A malformed encoding parses to NaN and so counts as needing a rehash.
  return Number(rawN) !== SCRYPT_N || Number(rawR) !== SCRYPT_R || Number(rawP) !== SCRYPT_P;
};
