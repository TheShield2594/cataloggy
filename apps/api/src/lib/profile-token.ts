import { createHmac, timingSafeEqual } from "node:crypto";

// A profile-access token is a stateless, signed capability proving the holder
// passed PIN verification for a specific profile. `resolveProfile` requires a
// valid one for any PIN-protected profile, so holding the shared API_TOKEN
// alone is no longer enough to read or mutate a locked profile's data by simply
// setting the `x-profile-id` header.
//
// The signing key is derived from API_TOKEN, which is always present in a
// running deployment (the production startup guard refuses to boot without it).
// Rotating API_TOKEN therefore invalidates every outstanding profile token —
// the desired behavior: a credential change forces re-verification.

const PROFILE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const TOKEN_VERSION = "v1";

const signingKey = () => process.env.API_TOKEN ?? "";

const sign = (profileId: string, expiresAt: number): string =>
  createHmac("sha256", signingKey()).update(`${TOKEN_VERSION}:${profileId}:${expiresAt}`).digest("base64url");

export const mintProfileToken = (profileId: string): string => {
  const expiresAt = Date.now() + PROFILE_TOKEN_TTL_MS;
  return `${TOKEN_VERSION}.${expiresAt}.${sign(profileId, expiresAt)}`;
};

export const verifyProfileToken = (token: string | undefined, profileId: string): boolean => {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expiresRaw, providedSig] = parts;
  if (version !== TOKEN_VERSION) return false;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  // Recompute the signature over the caller-supplied profileId, so a token
  // minted for profile A can never authorize profile B.
  const expectedSig = sign(profileId, expiresAt);
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  // Length pre-check: timingSafeEqual throws on unequal-length buffers.
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
};
