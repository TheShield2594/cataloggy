import { createHmac } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { CATALOGGY_API_TOKEN } from "./config.js";
import { isAllowedMutationOrigin, tokensMatch } from "./mutation-auth.js";
import { profilePathParam } from "./profile.js";

/**
 * The capability a "Mark Watched" subtitle URL carries, and the lines Stremio
 * shows back.
 *
 * Stremio's subtitle mechanism can only fetch a plain URL (no custom headers),
 * so /mark-watched/*.srt has to carry its credential as a query param, embedded
 * server-side when /subtitles builds the URL. But /subtitles itself answers
 * anyone who asks — the protocol sends no credentials, so this service cannot
 * gate it — which made embedding the mutation token there a disclosure: one
 * unauthenticated GET handed over the single token authorising every write this
 * service accepts, and with it the ability to forge watch history and scrobbles
 * for any profile whose id the caller knew.
 *
 * What goes into that URL now is a capability for exactly one write. It is
 * signed over the profile segment and the specific title or episode, and it
 * expires, so a URL read out of a subtitles response (or out of a proxy log)
 * buys nothing beyond re-marking the one title it was minted for — which is a
 * title its holder just watched being requested anyway.
 */
export type MarkWatchedTarget =
  | { type: "movie"; imdbId: string }
  | { type: "episode"; imdbId: string; season: number; episode: number };

// Long enough to still work at the end of a feature-length film that was paused
// for dinner — Stremio fetches the subtitle list once, when the player opens —
// and short enough that a captured URL goes stale within the day.
const MARK_WATCHED_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// The URL's own profile segment, which is what the write will be resolved
// against, rather than the id that segment resolves to: for the prefix-less URL
// there is no segment, and the default profile it falls back to is free to
// change between the mint and the write.
const markWatchedScope = (profileSegmentId: string | null, target: MarkWatchedTarget): string =>
  [
    "mark-watched",
    target.type,
    profileSegmentId ?? "-",
    target.imdbId,
    ...(target.type === "episode" ? [String(target.season), String(target.episode)] : []),
  ].join(":");

const signMarkWatched = (scope: string, expiry: number): string | null =>
  CATALOGGY_API_TOKEN
    ? createHmac("sha256", CATALOGGY_API_TOKEN).update(`${scope}:${expiry}`).digest("hex")
    : null;

/** `<expiry>.<signature>`, or null when there is no API token to sign with. */
export const mintMarkWatchedToken = (
  profileSegmentId: string | null,
  target: MarkWatchedTarget
): string | null => {
  const expiry = Date.now() + MARK_WATCHED_TOKEN_TTL_MS;
  const signature = signMarkWatched(markWatchedScope(profileSegmentId, target), expiry);
  return signature ? `${expiry}.${signature}` : null;
};

type CapabilityCheck = "ok" | "expired" | "invalid";

const checkMarkWatchedToken = (
  candidate: unknown,
  profileSegmentId: string | null,
  target: MarkWatchedTarget
): CapabilityCheck => {
  if (typeof candidate !== "string") return "invalid";
  const separator = candidate.indexOf(".");
  if (separator < 1) return "invalid";

  const expiry = Number(candidate.slice(0, separator));
  if (!Number.isInteger(expiry)) return "invalid";

  const expected = signMarkWatched(markWatchedScope(profileSegmentId, target), expiry);
  if (!tokensMatch(candidate.slice(separator + 1), expected)) return "invalid";

  // Only reached once the signature is known good, so "expired" never tells a
  // forger anything they didn't already have.
  return Date.now() < expiry ? "ok" : "expired";
};

/*
 * Stremio renders whatever comes back from /mark-watched as a subtitle line,
 * which is the only feedback channel available — so it has to be truthful.
 * Anything other than a recorded write says so explicitly rather than falling
 * through to the success text.
 */

export const MINIMAL_SRT = `1
00:00:00,000 --> 00:00:03,000
Marked as watched on Cataloggy
`;

export const SERIES_NO_EPISODE_SRT = `1
00:00:00,000 --> 00:00:03,000
Cannot mark a series as watched — select a specific episode first
`;

export const WATCH_FAILED_SRT = `1
00:00:00,000 --> 00:00:05,000
Cataloggy could not record this — check the addon logs
`;

const REJECTED_SRT = `1
00:00:00,000 --> 00:00:05,000
Cataloggy rejected this request — reinstall the addon from Settings
`;

export const UNKNOWN_PROFILE_SRT = `1
00:00:00,000 --> 00:00:05,000
Cataloggy profile not recognised — reinstall the addon from Settings
`;

const EXPIRED_SRT = `1
00:00:00,000 --> 00:00:05,000
This Cataloggy link has expired — reopen the title to get a fresh one
`;

/**
 * Why this mark-watched request must not proceed, as the line to send back —
 * or null when it may.
 *
 * Shared by both mark-watched routes: the profile has to be resolved before the
 * capability can be checked (it is signed over the URL's profile segment), and
 * the origin check stays alongside it as the browser-only barrier it always was.
 */
export const rejectMarkWatched = (
  request: FastifyRequest,
  token: unknown,
  target: MarkWatchedTarget
): string | null => {
  const check = checkMarkWatchedToken(token, profilePathParam(request) ?? null, target);
  if (check === "expired") {
    request.log.info(target, "Rejected mark-watched request: capability expired");
    return EXPIRED_SRT;
  }
  if (check !== "ok" || !isAllowedMutationOrigin(request)) {
    request.log.warn(
      { origin: request.headers.origin, ...target },
      "Rejected mark-watched request: missing/invalid capability or disallowed origin"
    );
    return REJECTED_SRT;
  }
  return null;
};
