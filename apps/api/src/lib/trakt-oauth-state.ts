import { randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";

// The OAuth callback is necessarily exempt from the API token gate — Trakt
// redirects a browser to it and cannot send a bearer token — so the only thing
// binding "who started this linking flow" to "who is finishing it" is the
// `state` parameter. Without one, anyone who can lure the operator's browser to
// the callback URL with an authorization code of their own can silently bind
// this install to *their* Trakt account, and the scheduled poller then imports
// their history into the operator's library.
const STATE_KEY_PREFIX = "trakt:oauth:state:";

// Long enough to authorize on trakt.tv (including logging in first), short
// enough that a stolen or leaked authorize URL stops working quickly.
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// 32 random bytes, hex-encoded. The value only ever travels in a URL, so hex
// keeps it free of characters that would need escaping on either leg.
const STATE_PATTERN = /^[0-9a-f]{64}$/;

const stateKey = (state: string) => `${STATE_KEY_PREFIX}${state}`;

const cutoff = () => new Date(Date.now() - OAUTH_STATE_TTL_MS);

/**
 * Mints a single-use `state` value and persists it, returning the value to
 * embed in the authorize URL.
 *
 * Expired rows are swept here rather than on a timer: the only thing that
 * creates them is a click on "Connect Trakt", so the table cannot grow without
 * someone repeatedly starting the flow, and each new start pays for the
 * cleanup of the ones before it.
 */
export const createOAuthState = async (): Promise<string> => {
  const state = randomBytes(32).toString("hex");
  await prisma.kV.create({
    data: { key: stateKey(state), value: "", updatedAt: new Date() },
  });
  await prisma.kV.deleteMany({
    where: { key: { startsWith: STATE_KEY_PREFIX }, updatedAt: { lt: cutoff() } },
  });
  return state;
};

/**
 * Verifies and consumes a `state` returned by Trakt, returning false when it is
 * missing, malformed, unknown or expired.
 *
 * The delete *is* the check: a single `deleteMany` scoped to the exact key and
 * an unexpired timestamp reports how many rows it removed, so two concurrent
 * callbacks carrying the same state cannot both pass. Expired rows are left for
 * the sweep in `createOAuthState` — deleting them here would make an expired
 * state indistinguishable from an unknown one for the *next* attempt, which is
 * the same answer either way.
 */
export const consumeOAuthState = async (candidate: unknown): Promise<boolean> => {
  if (typeof candidate !== "string" || !STATE_PATTERN.test(candidate)) return false;
  const { count } = await prisma.kV.deleteMany({
    where: { key: stateKey(candidate), updatedAt: { gte: cutoff() } },
  });
  return count > 0;
};
