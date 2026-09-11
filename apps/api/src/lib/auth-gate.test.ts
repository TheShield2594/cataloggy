import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import { gzipSync } from "node:zlib";
import { request as httpRequest } from "node:http";

// The gate reaches `lib/stremio-secret.ts`, which imports Prisma — and importing
// that opens a connection pool from a DATABASE_URL this suite has no business
// needing. Nothing here touches the database: `isStremioSecretPath` is a regex.
vi.mock("./prisma.js", () => ({ prisma: { profile: { findMany: vi.fn() } } }));

// `lib/auth.ts` reads API_TOKEN at module load, and `lib/stremio-secret.ts`
// derives the addon secret from it per call, so the token has to be in place
// before the gate is imported.
const API_TOKEN = "a".repeat(64);

const RATE_LIMIT_MAX = 10;

let app: FastifyInstance;

/**
 * Wires an instance the way `index.ts` does, in the same order and with the
 * same hook phases: the limiter registered as a deferred plugin, the gate
 * added straight after, and the routes registered as plugins — which is what
 * puts them behind the limiter's `onRoute` listener, exactly as the real
 * route modules are.
 */
const buildApp = async () => {
  vi.resetModules();
  process.env.API_TOKEN = API_TOKEN;
  const { registerAuthGate } = await import("./auth-gate.js");

  const instance = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  instance.register(rateLimit, {
    global: true,
    max: RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
  });
  instance.register(compress, { global: true, threshold: 1024, encodings: ["br", "gzip", "deflate"] });

  registerAuthGate(instance);

  instance.register(async (scope) => {
    scope.get("/health", async () => ({ ok: true }));
    scope.get("/watch/history", async () => ({ ok: true }));
    scope.post("/import", async (request) => ({ got: (request.body as { hello?: string })?.hello ?? null }));
  });

  await instance.ready();
  // A real socket, because one test needs to prove the reply arrives before the
  // client has sent a body — which `inject` cannot express.
  await instance.listen({ port: 0, host: "127.0.0.1" });
  return instance;
};

const serverPort = () => {
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return address.port;
};

const get = (url: string, token?: string) =>
  app.inject({ method: "GET", url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });

beforeEach(async () => {
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
  delete process.env.API_TOKEN;
});

describe("registerAuthGate", () => {
  it("lets a valid token through and refuses a wrong one", async () => {
    expect((await get("/watch/history", API_TOKEN)).statusCode).toBe(200);

    const wrong = await get("/watch/history", "b".repeat(64));
    expect(wrong.statusCode).toBe(401);
    // The web client keys "re-enter your API token" off this header.
    expect(wrong.headers["www-authenticate"]).toBe("Bearer");
  });

  it("refuses a request with no Authorization header at all", async () => {
    const res = await get("/watch/history");
    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toBe("Bearer");
  });

  it("leaves the public paths ungated", async () => {
    expect((await get("/health")).statusCode).toBe(200);
  });

  // The regression this module exists for. An auth hook on `onRequest` runs
  // before `@fastify/rate-limit`'s route-level hook, so every bad-token request
  // was answered 401 without consuming any budget — an unauthenticated flood
  // cost the attacker nothing and was counted nowhere.
  it("makes an unauthenticated flood consume rate-limit budget", async () => {
    const codes: number[] = [];
    for (let i = 0; i < RATE_LIMIT_MAX * 2; i++) {
      codes.push((await get("/watch/history", "b".repeat(64))).statusCode);
    }

    expect(codes.filter((code) => code === 401)).toHaveLength(RATE_LIMIT_MAX);
    expect(codes.filter((code) => code === 429)).toHaveLength(RATE_LIMIT_MAX);

    // And the budget a flood burned is gone for the valid token too, which is
    // what "the flood was absorbed" means.
    expect((await get("/watch/history", API_TOKEN)).statusCode).toBe(429);
  });

  it("counts a flood against the public paths too", async () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) await get("/watch/history", "b".repeat(64));
    expect((await get("/health")).statusCode).toBe(429);
  });

  // `preParsing` runs before the body is read, so a rejected request never makes
  // the server buffer one. This is what rules out `preHandler`, the other phase
  // that would fix the hook ordering: there the body is already parsed by the
  // time the token is looked at, so an unauthenticated caller could make the
  // server hold up to `MAX_BODY_SIZE_MB` first.
  //
  // Sending the headers and then nothing at all is what makes that observable:
  // a 401 that arrives while the request body is still outstanding can only
  // have been decided without it.
  it("answers an unauthenticated POST before its body is sent", async () => {
    const status = await new Promise<number | "no reply">((resolve) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: serverPort(),
          path: "/import",
          method: "POST",
          headers: {
            authorization: "Bearer wrong",
            "content-type": "application/json",
            "transfer-encoding": "chunked",
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        }
      );
      request.on("error", () => resolve("no reply"));
      // Headers are flushed; the body deliberately never follows.
      request.flushHeaders();
      setTimeout(() => {
        request.destroy();
        resolve("no reply");
      }, 2_000).unref();
    });

    expect(status).toBe(401);
  });

  it("still parses a body, compressed or not, once the token is good", async () => {
    const plain = await app.inject({
      method: "POST",
      url: "/import",
      headers: { authorization: `Bearer ${API_TOKEN}`, "content-type": "application/json" },
      payload: JSON.stringify({ hello: "world" }),
    });
    expect(plain.statusCode).toBe(200);
    expect(plain.json()).toEqual({ got: "world" });

    // The gate runs before `@fastify/compress`'s request-decompression hook,
    // which is route-level — so a gzipped body still inflates and parses.
    const gzipped = await app.inject({
      method: "POST",
      url: "/import",
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      payload: gzipSync(Buffer.from(JSON.stringify({ hello: "world" }))),
    });
    expect(gzipped.statusCode).toBe(200);
    expect(gzipped.json()).toEqual({ got: "world" });
  });
});

describe("isPublicPath", () => {
  const load = async () => {
    vi.resetModules();
    process.env.API_TOKEN = API_TOKEN;
    return (await import("./auth-gate.js")).isPublicPath;
  };

  it("covers the routes that cannot carry a bearer token", async () => {
    const isPublicPath = await load();
    expect(isPublicPath("/health")).toBe(true);
    expect(isPublicPath("/health/ready")).toBe(true);
    expect(isPublicPath("/addon")).toBe(true);
    expect(isPublicPath("/trakt/oauth/callback?code=x&state=y")).toBe(true);
    expect(isPublicPath("/webhooks/plex")).toBe(true);
    expect(isPublicPath("/webhooks/jellyfin")).toBe(true);
    expect(isPublicPath(`/addon/stremio/${"0".repeat(64)}/manifest.json`)).toBe(true);
  });

  it("gates everything else, including near-misses on the allowlist", async () => {
    const isPublicPath = await load();
    expect(isPublicPath("/watch/history")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/health/secret")).toBe(false);
    expect(isPublicPath("/addon/stremio/not-a-secret/manifest.json")).toBe(false);
    // A prefix match on the allowlist must not be satisfiable by a path that
    // merely starts with the same characters.
    expect(isPublicPath("/webhooksomething")).toBe(false);
    expect(isPublicPath("/addonfoo")).toBe(false);
  });
});
