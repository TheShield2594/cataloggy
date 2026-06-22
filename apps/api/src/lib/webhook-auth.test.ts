import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";

const makeRequest = (options: {
  query?: Record<string, string>;
  headers?: Record<string, string>;
  ip?: string;
}): FastifyRequest =>
  ({
    query: options.query ?? {},
    headers: options.headers ?? {},
    ip: options.ip ?? "127.0.0.1",
  }) as unknown as FastifyRequest;

const loadVerifyWebhookSecret = async () => (await import("./webhook-auth.js")).verifyWebhookSecret;

describe("verifyWebhookSecret", () => {
  const originalSecret = process.env.WEBHOOK_SECRET;

  afterEach(() => {
    process.env.WEBHOOK_SECRET = originalSecret;
    vi.resetModules();
  });

  it("rejects everything when WEBHOOK_SECRET is not configured", async () => {
    delete process.env.WEBHOOK_SECRET;
    vi.resetModules();
    const verifyWebhookSecret = await loadVerifyWebhookSecret();

    expect(verifyWebhookSecret(makeRequest({ query: { token: "anything" } }))).toBe(false);
  });

  it("accepts the secret via the token query param", async () => {
    process.env.WEBHOOK_SECRET = "shh-secret";
    vi.resetModules();
    const verifyWebhookSecret = await loadVerifyWebhookSecret();

    expect(verifyWebhookSecret(makeRequest({ query: { token: "shh-secret" } }))).toBe(true);
  });

  it("accepts the secret via the x-webhook-secret header", async () => {
    process.env.WEBHOOK_SECRET = "shh-secret";
    vi.resetModules();
    const verifyWebhookSecret = await loadVerifyWebhookSecret();

    expect(
      verifyWebhookSecret(makeRequest({ headers: { "x-webhook-secret": "shh-secret" } })),
    ).toBe(true);
  });

  it("rejects an incorrect secret", async () => {
    process.env.WEBHOOK_SECRET = "shh-secret";
    vi.resetModules();
    const verifyWebhookSecret = await loadVerifyWebhookSecret();

    expect(verifyWebhookSecret(makeRequest({ query: { token: "wrong" } }))).toBe(false);
  });

  it("rejects a missing secret without throwing", async () => {
    process.env.WEBHOOK_SECRET = "shh-secret";
    vi.resetModules();
    const verifyWebhookSecret = await loadVerifyWebhookSecret();

    expect(verifyWebhookSecret(makeRequest({}))).toBe(false);
  });
});

describe("isAllowedWebhookIp / WEBHOOK_ALLOWED_IPS", () => {
  const originalSecret = process.env.WEBHOOK_SECRET;
  const originalAllowedIps = process.env.WEBHOOK_ALLOWED_IPS;

  afterEach(() => {
    process.env.WEBHOOK_SECRET = originalSecret;
    process.env.WEBHOOK_ALLOWED_IPS = originalAllowedIps;
    vi.resetModules();
  });

  it("allows any IP when WEBHOOK_ALLOWED_IPS is unset", async () => {
    process.env.WEBHOOK_SECRET = "shh-secret";
    delete process.env.WEBHOOK_ALLOWED_IPS;
    vi.resetModules();
    const { verifyWebhookSecret } = await import("./webhook-auth.js");

    expect(
      verifyWebhookSecret(makeRequest({ query: { token: "shh-secret" }, ip: "203.0.113.5" })),
    ).toBe(true);
  });

  it("rejects requests from IPs not in WEBHOOK_ALLOWED_IPS", async () => {
    process.env.WEBHOOK_SECRET = "shh-secret";
    process.env.WEBHOOK_ALLOWED_IPS = "192.168.1.50";
    vi.resetModules();
    const { verifyWebhookSecret } = await import("./webhook-auth.js");

    expect(
      verifyWebhookSecret(makeRequest({ query: { token: "shh-secret" }, ip: "203.0.113.5" })),
    ).toBe(false);
  });

  it("accepts requests from an IP in WEBHOOK_ALLOWED_IPS", async () => {
    process.env.WEBHOOK_SECRET = "shh-secret";
    process.env.WEBHOOK_ALLOWED_IPS = "192.168.1.50, 192.168.1.51";
    vi.resetModules();
    const { verifyWebhookSecret } = await import("./webhook-auth.js");

    expect(
      verifyWebhookSecret(makeRequest({ query: { token: "shh-secret" }, ip: "192.168.1.51" })),
    ).toBe(true);
  });

  it("normalizes IPv4-mapped IPv6 addresses before matching", async () => {
    process.env.WEBHOOK_SECRET = "shh-secret";
    process.env.WEBHOOK_ALLOWED_IPS = "192.168.1.50";
    vi.resetModules();
    const { verifyWebhookSecret } = await import("./webhook-auth.js");

    expect(
      verifyWebhookSecret(
        makeRequest({ query: { token: "shh-secret" }, ip: "::ffff:192.168.1.50" }),
      ),
    ).toBe(true);
  });
});
