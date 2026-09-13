import { apiPost } from "../lib/api-client.js";
import { isAllowedMutationOrigin, isValidMutationToken } from "../lib/mutation-auth.js";
import { resolveProfileScope } from "../lib/profile.js";
import type { AddonRouter } from "../lib/router.js";

type ScrobbleAction = "start" | "pause" | "stop";

/**
 * Playback events from media players that can set headers — which is what lets
 * this route take a bearer token, unlike everything Stremio itself calls.
 */
export const registerScrobbleRoute = (routes: AddonRouter): void => {
  routes.post<{ Params: { action: string }; Body: unknown }>("/scrobble/:action", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");

    const action = request.params.action as ScrobbleAction;
    if (!["start", "pause", "stop"].includes(action)) {
      return reply.code(400).send({ error: "action must be one of: start, pause, stop" });
    }

    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : undefined;
    if (!isValidMutationToken(bearerToken) || !isAllowedMutationOrigin(request)) {
      request.log.warn(
        { origin: request.headers.origin },
        "Rejected scrobble request: missing/invalid token or disallowed origin"
      );
      return reply.code(403).send({ error: "Unauthorized" });
    }

    if (!request.body || typeof request.body !== "object") {
      return reply.code(400).send({ error: "Request body is required" });
    }

    const body = request.body as {
      imdbId?: unknown;
      type?: unknown;
      seriesImdbId?: unknown;
      season?: unknown;
      episode?: unknown;
      progress?: unknown;
    };

    if (typeof body.imdbId !== "string" || !body.imdbId.trim()) {
      return reply.code(400).send({ error: "imdbId is required" });
    }

    if (body.type !== "movie" && body.type !== "episode") {
      return reply.code(400).send({ error: "type must be one of: movie, episode" });
    }

    const scope = await resolveProfileScope(request);
    if (!scope.ok) {
      return reply.code(404).send({ error: "Unknown profile in addon URL" });
    }

    try {
      const result = await apiPost(`/scrobble/${action}`, {
        type: body.type,
        imdbId: body.imdbId,
        seriesImdbId: body.seriesImdbId ?? null,
        season: body.season ?? null,
        episode: body.episode ?? null,
        progress: body.progress ?? 0
      }, scope.profileId);
      return reply.send(result);
    } catch (error) {
      request.log.error(error, `Failed to forward scrobble/${action} to API`);
      return reply.code(502).send({ error: "Failed to forward scrobble event to API" });
    }
  });
};
