import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const CHANNEL_ID = "33333333-3333-4333-8333-333333333333";

const prismaMock = {
  notificationChannel: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
};
const sendToChannel = vi.fn();

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));
vi.mock("../lib/notification-channels.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/notification-channels.js")>()),
  sendToChannel: (...args: unknown[]) => sendToChannel(...args),
}));

const buildApp = (): Promise<FastifyInstance> => buildRouteApp(() => import("./notifications.js"));

const storedChannel = (over: Record<string, unknown> = {}) => ({
  id: CHANNEL_ID,
  kind: "ntfy",
  name: "Phone",
  url: "https://ntfy.sh/cataloggy",
  token: null,
  enabled: true,
  createdAt: new Date("2026-08-06T12:00:00Z"),
  profileId: PROFILE_ID,
  ...over,
});

describe("notification channel routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.notificationChannel.findMany.mockResolvedValue([storedChannel()]);
    prismaMock.notificationChannel.findFirst.mockResolvedValue(storedChannel());
    prismaMock.notificationChannel.count.mockResolvedValue(0);
    prismaMock.notificationChannel.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => storedChannel(data)
    );
    prismaMock.notificationChannel.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => storedChannel(data)
    );
    prismaMock.notificationChannel.deleteMany.mockResolvedValue({ count: 1 });
    sendToChannel.mockResolvedValue(undefined);
  });

  describe("GET /notifications/channels", () => {
    it("lists the calling profile's channels without their tokens", async () => {
      prismaMock.notificationChannel.findMany.mockResolvedValue([storedChannel({ token: "secret-token" })]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/notifications/channels" });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.notificationChannel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { profileId: PROFILE_ID } })
      );
      // The token is a credential for someone else's server, and nothing in the
      // UI needs it back — only whether one is set.
      expect(res.json().channels[0]).toMatchObject({ hasToken: true });
      expect(JSON.stringify(res.json())).not.toContain("secret-token");
    });
  });

  describe("POST /notifications/channels", () => {
    const create = (app: FastifyInstance, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/notifications/channels", payload });

    it("stores a channel against the calling profile", async () => {
      const app = await buildApp();

      const res = await create(app, { kind: "ntfy", name: "Phone", url: "https://ntfy.sh/cataloggy" });

      expect(res.statusCode).toBe(201);
      expect(prismaMock.notificationChannel.create).toHaveBeenCalledWith({
        data: {
          kind: "ntfy",
          name: "Phone",
          url: "https://ntfy.sh/cataloggy",
          token: null,
          enabled: true,
          profileId: PROFILE_ID,
        },
      });
    });

    it("allows a LAN target, which is the whole point of these channels", async () => {
      const app = await buildApp();

      const res = await create(app, { kind: "gotify", url: "http://192.168.1.25:8080", token: "app-token" });

      expect(res.statusCode).toBe(201);
    });

    it("stores the token encrypted when API_TOKEN is set", async () => {
      const originalToken = process.env.API_TOKEN;
      process.env.API_TOKEN = "notifications-route-token";
      try {
        const { SECRET_CONTEXT, decryptSecret } = await import("../lib/secret-box.js");
        const app = await buildApp();

        const res = await create(app, { kind: "gotify", url: "http://192.168.1.25:8080", token: "app-token" });

        expect(res.statusCode).toBe(201);
        const { token } = prismaMock.notificationChannel.create.mock.calls[0][0].data;
        expect(token).not.toBe("app-token");
        expect(decryptSecret(SECRET_CONTEXT.notificationChannelToken, token)).toBe("app-token");
        // A channel with a token still reports one, since that is all the UI
        // is ever told about it.
        expect(res.json().channel.hasToken).toBe(true);
      } finally {
        if (originalToken === undefined) delete process.env.API_TOKEN;
        else process.env.API_TOKEN = originalToken;
      }
    });

    it("rejects an unknown kind", async () => {
      const app = await buildApp();

      const res = await create(app, { kind: "telegram", url: "https://example.com/x" });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.notificationChannel.create).not.toHaveBeenCalled();
    });

    it("rejects a URL that targets the metadata service or isn't http(s)", async () => {
      const app = await buildApp();

      // A background job POSTs to this URL, so it gets the same treatment as
      // the AI provider endpoint and the push endpoint.
      for (const url of ["http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "nope"]) {
        expect((await create(app, { kind: "webhook", url })).statusCode).toBe(400);
      }
      expect(prismaMock.notificationChannel.create).not.toHaveBeenCalled();
    });

    it("rejects an ntfy URL with no topic in it", async () => {
      const app = await buildApp();

      // Posting to the bare server would 404 at send time, hours later.
      expect((await create(app, { kind: "ntfy", url: "https://ntfy.sh" })).statusCode).toBe(400);
      expect((await create(app, { kind: "ntfy", url: "https://ntfy.sh/" })).statusCode).toBe(400);
    });

    it("requires a token for Gotify, which rejects an unauthenticated message", async () => {
      const app = await buildApp();

      const res = await create(app, { kind: "gotify", url: "http://gotify.lan" });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/token is required/);
    });

    it("names an unnamed channel after its kind", async () => {
      const app = await buildApp();

      await create(app, { kind: "discord", url: "https://discord.com/api/webhooks/1/abc" });

      expect(prismaMock.notificationChannel.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: "Discord" }) })
      );
    });

    it("refuses to add more than the per-profile ceiling", async () => {
      prismaMock.notificationChannel.count.mockResolvedValue(10);
      const app = await buildApp();

      const res = await create(app, { kind: "ntfy", url: "https://ntfy.sh/topic" });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.notificationChannel.create).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /notifications/channels/:id", () => {
    const patch = (app: FastifyInstance, payload: Record<string, unknown>) =>
      app.inject({ method: "PATCH", url: `/notifications/channels/${CHANNEL_ID}`, payload });

    it("scopes the lookup to the calling profile", async () => {
      prismaMock.notificationChannel.findFirst.mockResolvedValue(null);
      const app = await buildApp();

      const res = await patch(app, { enabled: false });

      expect(res.statusCode).toBe(404);
      expect(prismaMock.notificationChannel.findFirst).toHaveBeenCalledWith({
        where: { id: CHANNEL_ID, profileId: PROFILE_ID },
      });
      expect(prismaMock.notificationChannel.update).not.toHaveBeenCalled();
    });

    it("disables a channel without touching the rest of it", async () => {
      const app = await buildApp();

      const res = await patch(app, { enabled: false });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.notificationChannel.update).toHaveBeenCalledWith({
        where: { id: CHANNEL_ID },
        data: { url: "https://ntfy.sh/cataloggy", token: null, enabled: false },
      });
    });

    it("keeps a stored token when the field is omitted, and clears it on an empty string", async () => {
      prismaMock.notificationChannel.findFirst.mockResolvedValue(
        storedChannel({ kind: "webhook", token: "existing" })
      );
      const app = await buildApp();

      // The UI never sees the token, so it can't send it back — omitting the
      // field has to mean "leave it alone".
      await patch(app, { name: "Renamed" });
      expect(prismaMock.notificationChannel.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ token: "existing", name: "Renamed" }) })
      );

      await patch(app, { token: "" });
      expect(prismaMock.notificationChannel.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ token: null }) })
      );
    });

    it("writes a kept token back exactly as stored, rather than encrypting the ciphertext again", async () => {
      const originalToken = process.env.API_TOKEN;
      process.env.API_TOKEN = "notifications-route-token";
      try {
        const { SECRET_CONTEXT, encryptSecret, decryptSecret } = await import("../lib/secret-box.js");
        const stored = encryptSecret(SECRET_CONTEXT.notificationChannelToken, "gotify-app-token");
        prismaMock.notificationChannel.findFirst.mockResolvedValue(storedChannel({ kind: "gotify", token: stored }));
        const app = await buildApp();

        await patch(app, { name: "Renamed" });

        const { token } = prismaMock.notificationChannel.update.mock.calls[0][0].data;
        expect(token).toBe(stored);
        expect(decryptSecret(SECRET_CONTEXT.notificationChannelToken, token)).toBe("gotify-app-token");
      } finally {
        if (originalToken === undefined) delete process.env.API_TOKEN;
        else process.env.API_TOKEN = originalToken;
      }
    });

    // Gotify's "a token is required" rule has to keep firing against a stored
    // token it cannot read, which is why the check takes a boolean now.
    it("accepts a Gotify edit that leaves the encrypted token alone", async () => {
      const originalToken = process.env.API_TOKEN;
      process.env.API_TOKEN = "notifications-route-token";
      try {
        const { SECRET_CONTEXT, encryptSecret } = await import("../lib/secret-box.js");
        prismaMock.notificationChannel.findFirst.mockResolvedValue(
          storedChannel({
            kind: "gotify",
            url: "http://192.168.1.25:8080",
            token: encryptSecret(SECRET_CONTEXT.notificationChannelToken, "app-token"),
          })
        );
        const app = await buildApp();

        const res = await patch(app, { name: "Renamed" });

        expect(res.statusCode).toBe(200);
      } finally {
        if (originalToken === undefined) delete process.env.API_TOKEN;
        else process.env.API_TOKEN = originalToken;
      }
    });

    it("re-validates a changed URL against the same rules as a new one", async () => {
      const app = await buildApp();

      const res = await patch(app, { url: "http://169.254.169.254/x" });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.notificationChannel.update).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /notifications/channels/:id", () => {
    it("deletes only the calling profile's channel", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/notifications/channels/${OTHER_PROFILE_ID}` });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.notificationChannel.deleteMany).toHaveBeenCalledWith({
        where: { id: OTHER_PROFILE_ID, profileId: PROFILE_ID },
      });
    });

    it("404s when nothing matched", async () => {
      prismaMock.notificationChannel.deleteMany.mockResolvedValue({ count: 0 });
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/notifications/channels/${CHANNEL_ID}` });

      expect(res.statusCode).toBe(404);
    });
  });

  // `NotificationChannel.id` is a uuid column, so Postgres errors on a
  // malformed value rather than matching nothing — without the guard each of
  // these is a 500 and a logged driver exception, not a 400.
  describe.each([
    { method: "PATCH" as const, url: `/notifications/channels/not-a-uuid`, payload: { enabled: false } },
    { method: "DELETE" as const, url: `/notifications/channels/not-a-uuid`, payload: undefined },
    { method: "POST" as const, url: `/notifications/channels/not-a-uuid/test`, payload: undefined },
  ])("$method $url", ({ method, url, payload }) => {
    it("rejects an id that is not a UUID before it reaches the database", async () => {
      const app = await buildApp();

      const res = await app.inject({ method, url, payload });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("id must be a valid UUID");
      expect(prismaMock.notificationChannel.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.notificationChannel.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("POST /notifications/channels/:id/test", () => {
    it("sends a real notification through the channel", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: `/notifications/channels/${CHANNEL_ID}/test` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(sendToChannel).toHaveBeenCalledWith(
        expect.objectContaining({ id: CHANNEL_ID }),
        expect.objectContaining({ event: "test" })
      );
    });

    it("reports a failure as a result rather than a 500", async () => {
      sendToChannel.mockRejectedValue(new Error("Phone: HTTP 403"));
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: `/notifications/channels/${CHANNEL_ID}/test` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: false, error: "Phone: HTTP 403" });
    });
  });
});
