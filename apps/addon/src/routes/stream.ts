import { forwardPlaySignal } from "../lib/play-signal.js";
import { resolveProfileScope } from "../lib/profile.js";
import type { AddonRouter } from "../lib/router.js";

/**
 * Always an empty list — see the manifest's note on why this route exists at
 * all: the request is the signal.
 */
export const registerStreamRoute = (routes: AddonRouter): void => {
  routes.get<{ Params: { type: string; id: string } }>("/stream/:type/:id.json", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Content-Type", "application/json");

    const { type, id } = request.params;
    if (type === "movie" || type === "series") {
      const scope = await resolveProfileScope(request);
      if (scope.ok) {
        forwardPlaySignal("stream", type, id, scope.profileId, request.headers["user-agent"], request.log);
      }
    }

    return reply.send({ streams: [] });
  });
};
