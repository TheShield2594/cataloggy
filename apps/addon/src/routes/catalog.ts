import { handleCatalog } from "../lib/catalog.js";
import { resolveProfileScope } from "../lib/profile.js";
import type { AddonRouter } from "../lib/router.js";

/**
 * A row on a Stremio home screen. Two routes for one job: Stremio appends an
 * `extra` segment (search text, a genre pick) only when there is one.
 *
 * A failure answers with an empty catalog rather than an error — Stremio shows
 * an error row as a broken addon, and the next refresh is a minute away.
 */
export const registerCatalogRoutes = (routes: AddonRouter): void => {
  routes.get<{ Params: { type: string; id: string } }>("/catalog/:type/:id.json", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Content-Type", "application/json");

    const scope = await resolveProfileScope(request);
    if (!scope.ok) return reply.send({ metas: [] });

    try {
      return reply.send(await handleCatalog(request.params.type, request.params.id, scope.profileId, request.log));
    } catch (error) {
      request.log.error(error, "Failed to fetch catalog items");
      return reply.send({ metas: [] });
    }
  });

  routes.get<{ Params: { type: string; id: string; extra: string } }>(
    "/catalog/:type/:id/:extra.json",
    async (request, reply) => {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Content-Type", "application/json");

      const scope = await resolveProfileScope(request);
      if (!scope.ok) return reply.send({ metas: [] });

      try {
        return reply.send(
          await handleCatalog(
            request.params.type,
            request.params.id,
            scope.profileId,
            request.log,
            request.params.extra
          )
        );
      } catch (error) {
        request.log.error(error, "Failed to fetch catalog items");
        return reply.send({ metas: [] });
      }
    }
  );
};
