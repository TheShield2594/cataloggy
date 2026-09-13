import { apiPost } from "../lib/api-client.js";
import {
  MINIMAL_SRT,
  rejectMarkWatched,
  SERIES_NO_EPISODE_SRT,
  UNKNOWN_PROFILE_SRT,
  WATCH_FAILED_SRT,
} from "../lib/mark-watched.js";
import { resolveProfileScope } from "../lib/profile.js";
import type { AddonRouter } from "../lib/router.js";

/**
 * What the "Mark Watched" subtitle URL actually does: record the watch, and
 * answer with a line saying whether it worked. See `lib/mark-watched.ts` for
 * the capability the URL carries.
 */
export const registerMarkWatchedRoutes = (routes: AddonRouter): void => {
  routes.get<{ Params: { type: string; imdbId: string }; Querystring: { token?: string } }>(
    "/mark-watched/:type/:imdbId.srt",
    async (request, reply) => {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Content-Type", "text/srt; charset=utf-8");

      const { type, imdbId } = request.params;

      if (type !== "movie") {
        // For series without episode info, return honest feedback instead of a silent no-op
        request.log.info({ type, imdbId }, "Series mark-watched requested without episode info — no-op");
        return reply.send(SERIES_NO_EPISODE_SRT);
      }

      const scope = await resolveProfileScope(request);
      if (!scope.ok) {
        request.log.warn({ imdbId }, "Rejected mark-watched request: malformed profile id in URL");
        return reply.send(UNKNOWN_PROFILE_SRT);
      }

      const rejection = rejectMarkWatched(request, request.query.token, { type: "movie", imdbId });
      if (rejection) return reply.send(rejection);

      try {
        await apiPost("/watch", { type: "movie", imdbId }, scope.profileId);
      } catch (error) {
        request.log.error(error, "Failed to mark as watched");
        return reply.send(WATCH_FAILED_SRT);
      }

      request.log.info({ type, imdbId, profileId: scope.profileId }, "Marked as watched from Stremio");
      return reply.send(MINIMAL_SRT);
    }
  );

  routes.get<{
    Params: { type: string; imdbId: string; season: string; episode: string };
    Querystring: { token?: string };
  }>("/mark-watched/:type/:imdbId/:season/:episode.srt", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Content-Type", "text/srt; charset=utf-8");

    const { imdbId, season: seasonStr, episode: episodeStr } = request.params;
    const season = parseInt(seasonStr, 10);
    const episode = parseInt(episodeStr, 10);

    const scope = await resolveProfileScope(request);
    if (!scope.ok) {
      request.log.warn({ imdbId, season, episode }, "Rejected mark-watched request: malformed profile id in URL");
      return reply.send(UNKNOWN_PROFILE_SRT);
    }

    const rejection = rejectMarkWatched(request, request.query.token, {
      type: "episode",
      imdbId,
      season,
      episode,
    });
    if (rejection) return reply.send(rejection);

    try {
      await apiPost("/watch", {
        type: "episode",
        imdbId: `${imdbId}:${season}:${episode}`, // episode-level ID
        seriesImdbId: imdbId,
        season,
        episode,
      }, scope.profileId);
    } catch (error) {
      request.log.error(error, "Failed to mark episode as watched");
      return reply.send(WATCH_FAILED_SRT);
    }

    request.log.info({ imdbId, season, episode, profileId: scope.profileId }, "Marked episode as watched from Stremio");
    return reply.send(MINIMAL_SRT);
  });
};
