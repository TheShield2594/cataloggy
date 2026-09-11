import type { FastifyInstance } from "fastify";
import { verifyToken } from "./auth.js";
import { isStremioSecretPath } from "./stremio-secret.js";

/**
 * Routes that cannot carry a bearer token by construction: the health probes,
 * Stremio's addon URLs (the protocol sends no credentials — an unguessable
 * per-profile secret in the path stands in, verified by the route handler), the
 * Trakt OAuth callback (a browser redirect from trakt.tv, bound to the flow that
 * started it by its `state`), and the Plex/Jellyfin webhooks (their own shared
 * secret). Everything else needs `API_TOKEN`.
 */
export const isPublicPath = (url: string): boolean =>
  url === "/health" ||
  url === "/health/ready" ||
  isStremioSecretPath(url) ||
  url === "/addon" ||
  url.startsWith("/trakt/oauth/callback") ||
  url.startsWith("/webhooks/");

/**
 * Gates every non-public route on `API_TOKEN`.
 *
 * The phase is load-bearing and the reason is not obvious. `@fastify/rate-limit`
 * does not install a global `onRequest` hook — it installs a *route-level* one,
 * from an `onRoute` listener (see its `index.js`). Fastify runs every
 * instance-level `onRequest` hook before any route-level one, so an auth hook
 * added here with `addHook("onRequest", …)` runs first no matter when the
 * limiter is registered: awaiting the registration first does not help, because
 * the ordering is between hook *phases*, not registration order.
 *
 * That ordering meant a request with a bad token was answered 401 and never
 * reached the limiter, so unauthenticated floods consumed no budget and were
 * effectively unlimited. `API_TOKEN` is 256 bits, so the concern was never
 * guessing — it was that the cheapest request to make was also the one nothing
 * counted.
 *
 * `preParsing` is the first phase that runs *after* route-level `onRequest`, so
 * the limiter sees the request first and a flood is bounded like any other. It
 * still runs before the body is read off the wire, so an unauthenticated caller
 * cannot make the server buffer up to `MAX_BODY_SIZE_MB` before being turned
 * away — which `preHandler`, the other phase that would fix the ordering, would
 * have allowed. It also runs before `@fastify/compress`'s request-decompression
 * hook, which is route-level and therefore later still.
 *
 * Covered by `auth-gate.test.ts`, which floods a wrong token and asserts the
 * 429s appear.
 */
export const registerAuthGate = (app: FastifyInstance): void => {
  app.addHook("preParsing", async (request, reply) => {
    if (isPublicPath(request.url)) return;
    // Not returned: `verifyToken` answers by sending the reply, and a hook that
    // returned it would be handing Fastify a reply where it expects a payload
    // stream. Fastify stops the lifecycle on its own once the reply is sent.
    await verifyToken(request, reply);
  });
};
