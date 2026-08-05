import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

const prismaMock = { pushSubscription: { upsert: vi.fn(), deleteMany: vi.fn() } };

const getPushPublicKey = vi.fn();
const resolvePushEndpoint = vi.fn();

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/push.js", () => ({ getPushPublicKey: () => getPushPublicKey() }));
vi.mock("../lib/ssrf.js", () => ({ resolvePushEndpoint: (...a: unknown[]) => resolvePushEndpoint(...a) }));
vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: pushRoutes } = await import("./push.js");
  const app = Fastify();
  await app.register(pushRoutes);
  await app.ready();
  return app;
};

const subscribeBody = (over: Record<string, unknown> = {}) => ({
  endpoint: ENDPOINT,
  keys: { p256dh: "p256dh-value", auth: "auth-value" },
  ...over,
});

describe("push routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPushPublicKey.mockResolvedValue("vapid-public-key");
    resolvePushEndpoint.mockResolvedValue(true);
    prismaMock.pushSubscription.upsert.mockResolvedValue({});
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
  });

  describe("GET /push/public-key", () => {
    it("returns the VAPID public key", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/push/public-key" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ publicKey: "vapid-public-key" });
      await app.close();
    });
  });

  describe("POST /push/subscribe", () => {
    it("stores a subscription against the calling profile", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/push/subscribe", payload: subscribeBody() });

      expect(res.statusCode).toBe(201);
      expect(prismaMock.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: ENDPOINT },
        create: { endpoint: ENDPOINT, p256dh: "p256dh-value", auth: "auth-value", profileId: PROFILE_ID },
        update: { p256dh: "p256dh-value", auth: "auth-value", profileId: PROFILE_ID },
      });
      await app.close();
    });

    it("re-subscribing rotates the keys rather than creating a second row", async () => {
      const app = await buildApp();

      await app.inject({
        method: "POST",
        url: "/push/subscribe",
        payload: subscribeBody({ keys: { p256dh: "new-p256dh", auth: "new-auth" } }),
      });

      expect(prismaMock.pushSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ p256dh: "new-p256dh" }) })
      );
      await app.close();
    });

    it("rejects an endpoint that is not a real push service", async () => {
      // Otherwise a stolen API token could point the notification job at an
      // internal address and use it as an SSRF proxy.
      resolvePushEndpoint.mockResolvedValue(false);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/push/subscribe",
        payload: subscribeBody({ endpoint: "http://169.254.169.254/latest/meta-data" }),
      });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.pushSubscription.upsert).not.toHaveBeenCalled();
      await app.close();
    });

    it("rejects a subscription missing its keys", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/push/subscribe",
        payload: { endpoint: ENDPOINT },
      });

      expect(res.statusCode).toBe(400);
      expect(resolvePushEndpoint).not.toHaveBeenCalled();
      await app.close();
    });

    it("rejects a blank endpoint", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/push/subscribe",
        payload: subscribeBody({ endpoint: "   " }),
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("POST /push/unsubscribe", () => {
    it("removes only the calling profile's subscription", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/push/unsubscribe",
        payload: { endpoint: ENDPOINT },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ subscribed: false });
      expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { endpoint: ENDPOINT, profileId: PROFILE_ID },
      });
      await app.close();
    });

    it("rejects a missing endpoint", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/push/unsubscribe", payload: {} });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.pushSubscription.deleteMany).not.toHaveBeenCalled();
      await app.close();
    });
  });
});
