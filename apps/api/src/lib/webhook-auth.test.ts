import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";

const makeRequest = (options: { query?: Record<string, string>; headers?: Record<string, string> }): FastifyRequest =>
  ({
    query: options.query ?? {},
    headers: options.headers ?? {},
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
