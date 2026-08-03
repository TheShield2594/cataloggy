import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getPushPublicKey } from "../lib/push.js";
import { resolveProfile } from "../lib/profile.js";
import { resolvePushEndpoint } from "../lib/ssrf.js";

type SubscribeBody = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

const pushRoutes: FastifyPluginAsync = async (app) => {
  app.get("/push/public-key", async () => {
    const publicKey = await getPushPublicKey();
    return { publicKey };
  });

  app.post<{ Body: unknown }>("/push/subscribe", { preHandler: resolveProfile }, async (request, reply) => {
    const body = request.body as SubscribeBody | null;
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
    const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
    const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";

    if (!endpoint || !p256dh || !auth) {
      return reply.code(400).send({ error: "endpoint and keys.p256dh/keys.auth are required" });
    }
    // Real push subscriptions only ever point at a browser vendor's push
    // service (e.g. fcm.googleapis.com, updates.push.services.mozilla.com) over
    // https. Rejecting anything else — including public names that resolve to a
    // private address — stops a stolen API token from turning the periodic
    // notification job into an SSRF proxy against internal/loopback addresses.
    if (!(await resolvePushEndpoint(endpoint))) {
      return reply.code(400).send({ error: "endpoint must be a valid https push service URL" });
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh, auth, profileId: request.profileId! },
      update: { p256dh, auth, profileId: request.profileId! },
    });

    return reply.code(201).send({ subscribed: true });
  });

  app.post<{ Body: unknown }>("/push/unsubscribe", { preHandler: resolveProfile }, async (request, reply) => {
    const body = request.body as { endpoint?: unknown } | null;
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint) {
      return reply.code(400).send({ error: "endpoint is required" });
    }

    await prisma.pushSubscription.deleteMany({ where: { endpoint, profileId: request.profileId! } });
    return { subscribed: false };
  });
};

export default pushRoutes;
