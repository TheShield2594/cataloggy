import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";

const makeRequest = (options: {
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  ip?: string;
  warn?: (...args: unknown[]) => void;
}): FastifyRequest =>
  ({
    query: options.query ?? {},
    headers: options.headers ?? {},
    ip: options.ip ?? "127.0.0.1",
    log: { warn: options.warn ?? (() => {}) },
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

  it("rejects a repeated query param rather than coercing the array", async () => {
    process.env.WEBHOOK_SECRET = "ab";
    vi.resetModules();
    const verifyWebhookSecret = await loadVerifyWebhookSecret();

    // "?token=a&token=b" reaches the handler as a two-element array, which
    // Buffer.from() would otherwise turn into two zero bytes of the right length.
    expect(verifyWebhookSecret(makeRequest({ query: { token: ["a", "b"] } }))).toBe(false);
  });

  it("rejects a non-ASCII secret of the same character length without throwing", async () => {
    // "€" is one character but three UTF-8 bytes, so a character-length
    // pre-check would let this through to timingSafeEqual and raise a RangeError.
    process.env.WEBHOOK_SECRET = "shh-secre€";
    vi.resetModules();
    const verifyWebhookSecret = await loadVerifyWebhookSecret();

    expect(verifyWebhookSecret(makeRequest({ query: { token: "shh-secret" } }))).toBe(false);
  });

  it("prefers the header when both forms are present", async () => {
    process.env.WEBHOOK_SECRET = "shh-secret";
    vi.resetModules();
    const verifyWebhookSecret = await loadVerifyWebhookSecret();
    const warn = vi.fn();

    expect(
      verifyWebhookSecret(
        makeRequest({
          headers: { "x-webhook-secret": "shh-secret" },
          query: { token: "wrong" },
          warn,
        }),
      ),
    ).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once per process when the secret arrives in the query string", async () => {
    process.env.WEBHOOK_SECRET = "shh-secret";
    vi.resetModules();
    const verifyWebhookSecret = await loadVerifyWebhookSecret();
    const warn = vi.fn();

    verifyWebhookSecret(makeRequest({ query: { token: "shh-secret" }, warn }));
    verifyWebhookSecret(makeRequest({ query: { token: "shh-secret" }, warn }));

    // A scrobbling media server hits this on every play; the advice only needs
    // saying once, and the line must never carry the secret itself.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain("shh-secret");
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
