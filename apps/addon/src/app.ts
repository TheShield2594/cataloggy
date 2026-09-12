import Fastify, { type RawRequestDefaultExpression } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { normalizeProxyPath, redactedRequestSerializer } from "@cataloggy/shared";
import { Sentry } from "./lib/sentry.js";
import { LOG_LEVEL, PROXY_PATH_PREFIXES, trustProxy } from "./lib/config.js";
import { addonRouter } from "./lib/router.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerManifestRoute } from "./routes/manifest.js";
import { registerMarkWatchedRoutes } from "./routes/mark-watched.js";
import { registerMetaRoute } from "./routes/meta.js";
import { registerConfigureRoute, registerHealthRoute } from "./routes/misc.js";
import { registerScrobbleRoute } from "./routes/scrobble.js";
import { registerStreamRoute } from "./routes/stream.js";
import { registerSubtitlesRoute } from "./routes/subtitles.js";

/**
 * The Stremio addon service: the server itself, and the routes it carries.
 *
 * This file was 1,283 lines — routing, caching, an HTTP client, auth, SRT
 * generation and play-signal inference in one scroll, with a single lib file
 * beside it. It is now the assembly, mirroring how `apps/api` is laid out:
 * `lib/` for everything that is a decision (who this request is acting as,
 * what may write, what is worth caching and for how long), `routes/` for the
 * endpoints Stremio actually calls.
 */

export const app = Fastify({
  logger: {
    level: LOG_LEVEL,
    // Every "Mark Watched" click arrives as `GET /mark-watched/…?token=<capability>`
    // — Stremio can only click a link, so the capability has nowhere but the
    // query string to travel. Fastify's default `req` serializer would write
    // that URL to the log verbatim, and `docker-compose.yml` keeps 30 MB of
    // those logs per service on the host, where a log shipper or a support
    // bundle pasted into an issue can carry the token off with them.
    serializers: { req: redactedRequestSerializer },
  },
  ...(trustProxy !== undefined ? { trustProxy } : {}),
  rewriteUrl: (request: RawRequestDefaultExpression) => normalizeProxyPath(request.url ?? "/", PROXY_PATH_PREFIXES)
});

// ─── Rate limiting ───
// All routes here are unauthenticated (Stremio doesn't send credentials), so apply a global limit.

app.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: "1 minute",
  keyGenerator: (request) => request.ip,
});

// ─── Error tracking (opt-in via SENTRY_DSN) ───

Sentry.setupFastifyErrorHandler(app);

// ─── Routes ───
//
// Everything Stremio calls is registered through `addonRouter`, which serves it
// both bare and under the per-profile prefix — see `lib/profile.ts`. `/health`
// is the exception: it is this container's own, not part of the addon protocol.

const routes = addonRouter(app);

registerHealthRoute(app);
registerManifestRoute(routes);
registerCatalogRoutes(routes);
registerMetaRoute(routes);
registerStreamRoute(routes);
registerSubtitlesRoute(routes);
registerMarkWatchedRoutes(routes);
registerScrobbleRoute(routes);
registerConfigureRoute(routes);
