import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";

class FakeReply {
  headers: Record<string, string> = {};
  header(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }
}

const makeRequest = (origin?: string, method = "GET"): FastifyRequest =>
  ({ headers: { origin }, method }) as unknown as FastifyRequest;

const loadCors = async () => import("./cors.js");

describe("cors", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowedOrigins = process.env.CATALOGGY_ALLOWED_ORIGINS;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.CATALOGGY_ALLOWED_ORIGINS = originalAllowedOrigins;
    vi.resetModules();
  });

  describe("development mode", () => {
    it("allows any origin, including none", async () => {
      process.env.NODE_ENV = "development";
      vi.resetModules();
      const { isAllowedOrigin, applyCorsHeaders } = await loadCors();
      const reply = new FakeReply();

      expect(isAllowedOrigin(undefined)).toBe(true);
      expect(isAllowedOrigin("https://anything.example")).toBe(true);

      applyCorsHeaders(makeRequest("https://anything.example"), reply as unknown as FastifyReply);
      expect(reply.headers["Access-Control-Allow-Origin"]).toBe("https://anything.example");
    });
  });

  describe("production mode", () => {
    it("only allows origins listed in CATALOGGY_ALLOWED_ORIGINS", async () => {
      process.env.NODE_ENV = "production";
      process.env.CATALOGGY_ALLOWED_ORIGINS = "https://app.example.com, https://other.example.com";
      vi.resetModules();
      const { isAllowedOrigin, applyCorsHeaders } = await loadCors();

      expect(isAllowedOrigin("https://app.example.com")).toBe(true);
      expect(isAllowedOrigin("https://other.example.com")).toBe(true);
      expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
      expect(isAllowedOrigin(undefined)).toBe(false);

      const allowedReply = new FakeReply();
      applyCorsHeaders(makeRequest("https://app.example.com"), allowedReply as unknown as FastifyReply);
      expect(allowedReply.headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com");

      const blockedReply = new FakeReply();
      applyCorsHeaders(makeRequest("https://evil.example.com"), blockedReply as unknown as FastifyReply);
      expect(blockedReply.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });

    it("does not allow any origin when CATALOGGY_ALLOWED_ORIGINS is unset", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.CATALOGGY_ALLOWED_ORIGINS;
      vi.resetModules();
      const { isAllowedOrigin } = await loadCors();

      expect(isAllowedOrigin("https://app.example.com")).toBe(false);
    });
  });
});
