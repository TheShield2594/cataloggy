import type { FastifyBaseLogger } from "fastify";
import { apiPost } from "./api-client.js";
import { PLAY_DETECTION } from "./config.js";

/**
 * Inferring "about to watch this" from what a client asks for.
 *
 * Addons are never told what was watched — a client only ever asks them for
 * things. But two of those asks mean the user is about to watch something:
 * `stream` (they opened a title's stream list) and `subtitles` (a player
 * loaded). Forwarding them lets Cataloggy infer watches from clients that keep
 * their library entirely to themselves — Vidi, Omni, Nuvio and other
 * addon-consuming apps that never sync to a Stremio account.
 *
 * Fire-and-forget on purpose: this must never delay or fail the response a
 * client is waiting on. The API decides what to do with a signal (and drops it
 * entirely unless play detection is enabled there) — this side only observes.
 */

// Bounded here rather than at the API: this string is whatever a client chose
// to send, and it exists only to be read back in Settings.
const MAX_CLIENT_LENGTH = 200;

export const forwardPlaySignal = (
  resource: "stream" | "subtitles",
  type: "movie" | "series",
  id: string,
  profileId: string | null,
  client: string | undefined,
  logger: FastifyBaseLogger
): void => {
  if (!PLAY_DETECTION) return;

  const [imdbId, seasonPart, episodePart] = id.split(":");
  if (!imdbId?.startsWith("tt")) return;

  // The whole token has to be a number. `Number.parseInt` takes a numeric
  // prefix, so `tt0903747:1junk:2junk` used to read as S1E2 and file a signal
  // against an episode nobody opened. Zero is allowed on purpose: Stremio
  // numbers a show's specials as season 0.
  const partAsNumber = (value: string | undefined): number | null =>
    value !== undefined && /^\d{1,9}$/.test(value) ? Number(value) : null;

  const season = partAsNumber(seasonPart);
  const episode = partAsNumber(episodePart);
  const episodeRef =
    type === "series" && season !== null && episode !== null
      ? { seriesImdbId: imdbId, season, episode }
      : null;

  // A bare series id means the user opened the show, not an episode — there is
  // nothing specific enough to record. A half-parsed one says even less.
  if (type === "series" && !episodeRef) return;

  void apiPost(
    "/stremio/play-signal",
    {
      type: episodeRef ? "episode" : "movie",
      imdbId,
      ...(episodeRef ?? {}),
      resource,
      // The player's own user-agent. Without forwarding it the API would only
      // ever see this service's fetch agent, which says nothing about which app
      // is actually watching — the one thing this field is for.
      ...(client?.trim() ? { client: client.trim().slice(0, MAX_CLIENT_LENGTH) } : {}),
    },
    profileId
  ).catch((error: unknown) => {
    logger.warn({ error, resource, id }, "Failed to forward play signal");
  });
};
