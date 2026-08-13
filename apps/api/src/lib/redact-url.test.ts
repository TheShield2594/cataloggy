import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { redactUrl, redactedRequestSerializer } from "@cataloggy/shared";

describe("redactUrl", () => {
  it("leaves a URL without a query string alone", () => {
    expect(redactUrl("/webhooks/plex")).toBe("/webhooks/plex");
  });

  it("masks the webhook secret Plex has no choice but to send in the query", () => {
    expect(redactUrl("/webhooks/plex?token=super-secret")).toBe("/webhooks/plex?token=REDACTED");
  });

  it("keeps non-sensitive parameters readable so the log stays useful", () => {
    expect(redactUrl("/webhooks/plex?profile=abc-123&token=super-secret&debug=1")).toBe(
      "/webhooks/plex?profile=abc-123&token=REDACTED&debug=1",
    );
  });

  it("masks every occurrence of a repeated sensitive parameter", () => {
    expect(redactUrl("/webhooks/plex?token=one&token=two")).toBe(
      "/webhooks/plex?token=REDACTED&token=REDACTED",
    );
  });

  it("matches the parameter name case-insensitively", () => {
    expect(redactUrl("/webhooks/jellyfin?Token=super-secret")).toBe(
      "/webhooks/jellyfin?Token=REDACTED",
    );
  });

  it("matches a percent-encoded parameter name", () => {
    expect(redactUrl("/webhooks/plex?%74oken=super-secret")).toBe(
      "/webhooks/plex?%74oken=REDACTED",
    );
  });

  it("does not mask a parameter that merely contains a sensitive name", () => {
    expect(redactUrl("/search?tokenizer=simple")).toBe("/search?tokenizer=simple");
  });

  it("leaves a valueless parameter untouched — there is nothing in it to leak", () => {
    expect(redactUrl("/webhooks/plex?token")).toBe("/webhooks/plex?token");
  });

  it("masks only up to the first '=' so a secret containing one is fully covered", () => {
    expect(redactUrl("/webhooks/plex?token=a=b=c")).toBe("/webhooks/plex?token=REDACTED");
  });

  it("survives a malformed percent escape in the parameter name", () => {
    expect(redactUrl("/webhooks/plex?%=1&token=super-secret")).toBe(
      "/webhooks/plex?%=1&token=REDACTED",
    );
  });

  it("handles an empty query string", () => {
    expect(redactUrl("/webhooks/plex?")).toBe("/webhooks/plex?");
  });
});

// The helper being correct is only half of it — what matters is that Fastify
// actually routes its request logging through it. This boots a real instance
// with the serializer index.ts installs and reads what lands in the log.
describe("redactedRequestSerializer wired into Fastify", () => {
  const captureLogs = async (url: string) => {
    const lines: Record<string, unknown>[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of String(chunk).split("\n").filter(Boolean)) {
          lines.push(JSON.parse(line));
        }
        callback();
      },
    });

    const app = Fastify({
      logger: { serializers: { req: redactedRequestSerializer }, stream: destination },
    });
    app.get("/webhooks/plex", async () => ({ ok: true }));

    try {
      const response = await app.inject({ method: "GET", url });
      return { response, logged: JSON.stringify(lines) };
    } finally {
      await app.close();
    }
  };

  it("never writes the webhook secret to the log", async () => {
    const { response, logged } = await captureLogs(
      "/webhooks/plex?token=super-secret&profile=abc-123",
    );

    expect(response.statusCode).toBe(200);
    expect(logged).not.toContain("super-secret");
    expect(logged).toContain("token=REDACTED");
    // The rest of the line still has to be worth keeping.
    expect(logged).toContain("profile=abc-123");
    expect(logged).toContain("/webhooks/plex");
  });

  it("keeps the fields Fastify's own request serializer emits", async () => {
    const { logged } = await captureLogs("/webhooks/plex");
    const request = JSON.parse(logged).find((line: { req?: unknown }) => line.req)?.req;

    expect(request).toMatchObject({ method: "GET", url: "/webhooks/plex" });
    expect(request).toHaveProperty("host");
    expect(request).toHaveProperty("remoteAddress");
  });
});
