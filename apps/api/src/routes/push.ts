import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getPushPublicKey } from "../lib/push.js";
import { resolveProfile } from "../lib/profile.js";

type SubscribeBody = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

// Real push subscriptions only ever point at a browser vendor's push
// service (e.g. fcm.googleapis.com, updates.push.services.mozilla.com)
// over https. Rejecting anything else stops a stolen API token from
// turning the periodic notification job into an SSRF proxy against
// internal/loopback addresses.
const isValidPushEndpoint = (endpoint: string): boolean => {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    hostname === "::1"
  ) {
    return false;
  }

  return true;
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
    if (!isValidPushEndpoint(endpoint)) {
      return reply.code(400).send({ error: "endpoint must be a valid https push service URL" });
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh, auth, profileId: request.profileId! },
      update: { p256dh, auth, profileId: request.profileId! },
    });

    return reply.code(201).send({ subscribed: true });
  });

  app.post<{ Body: unknown }>("/push/unsubscribe", async (request, reply) => {
    const body = request.body as { endpoint?: unknown } | null;
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint) {
      return reply.code(400).send({ error: "endpoint is required" });
    }

    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { subscribed: false };
  });
};

export default pushRoutes;
