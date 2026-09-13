import { parseSeriesProgressResponse } from "@cataloggy/shared";
import { apiGet, apiHeaders, apiUrl, fetchWithTimeout } from "../lib/api-client.js";
import {
  applyRpdbPoster,
  fetchRpdbConfig,
  isSpoilerProtectionEnabled,
} from "../lib/cataloggy-data.js";
import { resolveProfileScope } from "../lib/profile.js";
import type { AddonRouter } from "../lib/router.js";

/**
 * A title's detail page: the API's own metadata, with the RPDB poster swapped
 * in and the description withheld when spoiler protection says so.
 */
export const registerMetaRoute = (routes: AddonRouter): void => {
  routes.get<{ Params: { type: string; id: string } }>("/meta/:type/:id.json", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    const { type, id } = request.params;

    if (type !== "movie" && type !== "series") {
      return reply.code(400).send({ error: "type must be one of: movie, series" });
    }

    const imdbId = id.trim();
    if (!imdbId) {
      return reply.code(400).send({ error: "id is required" });
    }

    const scope = await resolveProfileScope(request);
    if (!scope.ok) return reply.code(404).send({ error: "Unknown profile in addon URL" });

    const [upstreamResponse, rpdb, spoilerEnabled] = await Promise.all([
      fetchWithTimeout(apiUrl(`/meta/${type}/${encodeURIComponent(imdbId)}`), {
        headers: apiHeaders(scope.profileId),
      }),
      fetchRpdbConfig(scope.profileId, request.log),
      isSpoilerProtectionEnabled(scope.profileId, request.log),
    ]);
    const payload = await upstreamResponse.json().catch(() => ({}));

    if (!upstreamResponse.ok) {
      return reply.code(upstreamResponse.status).send(payload);
    }

    const releaseInfo = typeof payload.year === "number" ? String(payload.year) : undefined;
    const genres = Array.isArray(payload.genres) ? payload.genres : undefined;
    const rating = typeof payload.rating === "number" ? payload.rating : undefined;

    // Use RPDB poster if configured, otherwise fall back to TMDB poster
    const poster = rpdb.apiKey
      ? applyRpdbPoster(imdbId, rpdb.apiKey)
      : (typeof payload.poster === "string" ? payload.poster : undefined);

    // Spoiler protection: hide description for series the user hasn't finished
    let description = typeof payload.description === "string" ? payload.description : undefined;
    if (spoilerEnabled && type === "series" && description) {
      const spoilerMsg = "[Spoiler protection enabled — description hidden until you finish this series]";
      let shouldHide = true; // default: hide unless confirmed completed
      try {
        const progressRes = await apiGet(
          `/series/progress/${encodeURIComponent(imdbId)}`,
          scope.profileId,
          parseSeriesProgressResponse
        );
        if (progressRes.progress) {
          const { watchedEpisodes, totalEpisodes } = progressRes.progress;
          // Only show description if user has finished all episodes
          if (typeof watchedEpisodes === "number" && typeof totalEpisodes === "number" && watchedEpisodes >= totalEpisodes) {
            shouldHide = false;
          }
        }
        // No progress row = not started = hide
      } catch (error) {
        request.log.debug(error, "Failed to fetch series progress for spoiler check, hiding description");
      }
      if (shouldHide) {
        description = spoilerMsg;
      }
    }

    const meta: Record<string, unknown> = {
      id: imdbId,
      type,
      name: typeof payload.name === "string" && payload.name.trim() ? payload.name : imdbId,
      poster,
      background: typeof payload.background === "string" ? payload.background : undefined,
      description,
      releaseInfo,
      year: typeof payload.year === "number" ? payload.year : undefined,
    };

    if (genres?.length) meta.genres = genres;
    if (rating !== undefined) meta.imdbRating = String(rating);
    if (typeof payload.totalSeasons === "number") meta.totalSeasons = payload.totalSeasons;
    if (typeof payload.totalEpisodes === "number") meta.totalEpisodes = payload.totalEpisodes;

    return reply.send({ meta });
  });
};
