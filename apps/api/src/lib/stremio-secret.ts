import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.js";

// The Stremio addon protocol has no auth: Stremio fetches a manifest URL and
// every resource URL hanging off it with no credentials, so the API's addon
// routes cannot sit behind `API_TOKEN`. Left bare, that makes a profile's
// watchlist, recently-watched and continue-watching lists readable by anyone
// who can reach the server.
//
// The standard private-addon answer is to put an unguessable secret in the URL
// path, which is what this derives. It comes from `API_TOKEN` via HMAC — the
// same construction the addon service uses for its mutation token — so it needs
// no extra configuration and no storage, and a URL that leaks (via proxy or
// access logs, say) does not yield the token it came from. Rotating `API_TOKEN`
// rotates every addon URL with it.
//
// The secret is per profile, so it doubles as the profile selector: the URL a
// profile installs serves that profile's lists and nothing else, which is what
// closes the `?profileId=` targeting the query param used to allow.
const SECRET_LABEL = "cataloggy-stremio-addon";

const SECRET_PATTERN = /^[0-9a-f]{64}$/;

/** Path shape the API token gate treats as a candidate public addon URL. */
const SECRET_PATH_PATTERN = /^\/addon\/stremio\/[0-9a-f]{64}(?:\/|$)/;

export const deriveStremioSecret = (profileId: string): string | null => {
  const apiToken = process.env.API_TOKEN;
  if (!apiToken) return null;
  return createHmac("sha256", apiToken).update(`${SECRET_LABEL}:${profileId}`).digest("hex");
};

// Both sides are fixed-width hex digests, so the length guard — needed because
// `timingSafeEqual` throws on a length mismatch — cannot leak anything.
const secretsMatch = (presented: string, expected: string): boolean => {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

/**
 * Resolves the profile a secret-scoped addon URL belongs to, or null when the
 * secret is malformed, unknown, or `API_TOKEN` is unset.
 *
 * Secrets are derived rather than stored, so this walks the profiles and
 * re-derives — a household's worth of HMACs per request, against a table that
 * holds one row per person.
 */
export const resolveProfileFromStremioSecret = async (candidate: unknown): Promise<string | null> => {
  if (typeof candidate !== "string" || !SECRET_PATTERN.test(candidate)) return null;

  const profiles = await prisma.profile.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  for (const profile of profiles) {
    const expected = deriveStremioSecret(profile.id);
    if (expected && secretsMatch(candidate, expected)) return profile.id;
  }
  return null;
};

/**
 * Whether a request URL is shaped like a secret-scoped addon URL, and so may
 * skip the bearer-token check. This is deliberately structural only — the route
 * handler is what verifies the secret and 404s on a bad one — so the token gate
 * stays synchronous and free of database work on every request.
 */
export const isStremioSecretPath = (url: string): boolean =>
  SECRET_PATH_PATTERN.test(url.split("?")[0]);
