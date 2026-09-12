import { cacheKeyFor, cacheSet, type CacheEntry } from "../lib/cache.js";
import { fetchAddonConfig, fetchAllLists, fetchGenres } from "../lib/cataloggy-data.js";
import { buildManifest } from "../lib/manifest.js";
import { resolveProfileScope } from "../lib/profile.js";
import type { AddonRouter } from "../lib/router.js";

const manifestCache = new Map<string, CacheEntry<object>>();
const MANIFEST_CACHE_TTL_MS = 60_000;

/** What Stremio fetches to install the addon, and re-fetches to refresh it. */
export const registerManifestRoute = (routes: AddonRouter): void => {
  routes.get("/manifest.json", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Content-Type", "application/json");

    const scope = await resolveProfileScope(request);
    if (!scope.ok) return reply.code(404).send({ error: "Unknown profile in addon URL" });

    const now = Date.now();
    const cacheKey = cacheKeyFor(scope.profileId);
    const cached = manifestCache.get(cacheKey);
    if (cached && now < cached.expiry) {
      return reply.send(cached.data);
    }

    try {
      const [lists, genres, config] = await Promise.all([
        fetchAllLists(scope.profileId),
        fetchGenres(scope.profileId, request.log),
        fetchAddonConfig(scope.profileId, request.log),
      ]);
      const data = buildManifest(lists, genres, config);
      cacheSet(manifestCache, cacheKey, { data, expiry: now + MANIFEST_CACHE_TTL_MS });
      return reply.send(data);
    } catch (error) {
      request.log.error(error, "Failed to fetch lists for manifest");
      return reply.code(502).send({ error: "Failed to build manifest" });
    }
  });
};
