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

  // Absent reads as NaN, which `isEpisode` below already rejects — so a bare
  // series id and a malformed one take the same path they always did.
  const season = seasonPart === undefined ? NaN : Number.parseInt(seasonPart, 10);
  const episode = episodePart === undefined ? NaN : Number.parseInt(episodePart, 10);
  const isEpisode = type === "series" && Number.isInteger(season) && Number.isInteger(episode);

  // A bare series id means the user opened the show, not an episode — there is
  // nothing specific enough to record.
  if (type === "series" && !isEpisode) return;

  void apiPost(
    "/stremio/play-signal",
    {
      type: isEpisode ? "episode" : "movie",
      imdbId,
      ...(isEpisode ? { seriesImdbId: imdbId, season, episode } : {}),
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
