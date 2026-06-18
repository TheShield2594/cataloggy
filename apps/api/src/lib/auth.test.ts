import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";

class FakeReply {
  statusCode?: number;
  body?: unknown;
  code(code: number) {
    this.statusCode = code;
    return this;
  }
  send(payload: unknown) {
    this.body = payload;
    return this;
  }
}

const makeRequest = (authorization?: string): FastifyRequest =>
  ({
    headers: { authorization },
    log: { error: vi.fn() },
  }) as unknown as FastifyRequest;

const loadVerifyToken = async () => (await import("./auth.js")).verifyToken;

describe("verifyToken", () => {
  const originalToken = process.env.API_TOKEN;

  afterEach(() => {
    process.env.API_TOKEN = originalToken;
    vi.resetModules();
  });

  it("returns 500 when API_TOKEN is not configured", async () => {
    delete process.env.API_TOKEN;
    vi.resetModules();
    const verifyToken = await loadVerifyToken();
    const reply = new FakeReply();

    await verifyToken(makeRequest("Bearer anything"), reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(500);
  });

  it("returns 401 when no Authorization header is present", async () => {
    process.env.API_TOKEN = "secret-token";
    vi.resetModules();
    const verifyToken = await loadVerifyToken();
    const reply = new FakeReply();

    await verifyToken(makeRequest(undefined), reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(401);
  });

  it("returns 401 for a malformed Authorization header", async () => {
    process.env.API_TOKEN = "secret-token";
    vi.resetModules();
    const verifyToken = await loadVerifyToken();
    const reply = new FakeReply();

    await verifyToken(makeRequest("secret-token"), reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(401);
  });

  it("returns 401 for an incorrect token", async () => {
    process.env.API_TOKEN = "secret-token";
    vi.resetModules();
    const verifyToken = await loadVerifyToken();
    const reply = new FakeReply();

    await verifyToken(makeRequest("Bearer wrong-token"), reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(401);
  });

  it("lets the request through for the correct token", async () => {
    process.env.API_TOKEN = "secret-token";
    vi.resetModules();
    const verifyToken = await loadVerifyToken();
    const reply = new FakeReply();

    await verifyToken(makeRequest("Bearer secret-token"), reply as unknown as FastifyReply);

    expect(reply.statusCode).toBeUndefined();
  });
});
