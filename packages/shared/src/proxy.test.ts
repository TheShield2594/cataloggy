import { describe, expect, it } from "vitest";
import { normalizeProxyPath, parseProxyPathPrefixes, parseTrustProxy, stripProxyPrefix } from "./proxy.js";

// This module decides two things a reverse-proxied deployment depends on:
// which path prefix is stripped before routing (get it wrong and every route
// 404s behind the proxy), and whether `request.ip` is the client or the proxy.
// The second is the security-relevant one — `request.ip` keys the rate limit
// and the WEBHOOK_ALLOWED_IPS allowlist, so trusting X-Forwarded-* too widely
// lets a client pick its own address, and too narrowly puts a whole household
// in one bucket.

describe("parseProxyPathPrefixes", () => {
  it("falls back when unset or blank", () => {
    expect(parseProxyPathPrefixes(undefined, ["/api"])).toEqual(["/api"]);
    expect(parseProxyPathPrefixes("", ["/api"])).toEqual(["/api"]);
    expect(parseProxyPathPrefixes("  ,  ,", ["/api"])).toEqual(["/api"]);
  });

  it("returns a copy of the fallback, not the caller's array", () => {
    const fallback = ["/api"] as const;
    expect(parseProxyPathPrefixes(undefined, fallback)).not.toBe(fallback);
  });

  it("splits a list and trims each entry", () => {
    expect(parseProxyPathPrefixes("/api, /cataloggy", ["/x"])).toEqual(["/api", "/cataloggy"]);
  });

  it("adds the leading slash a hand-written value usually omits", () => {
    expect(parseProxyPathPrefixes("api", ["/x"])).toEqual(["/api"]);
  });

  it("drops trailing slashes, so /api/ and /api mount the same", () => {
    expect(parseProxyPathPrefixes("/api/", ["/x"])).toEqual(["/api"]);
    expect(parseProxyPathPrefixes("/api///", ["/x"])).toEqual(["/api"]);
  });

  it("keeps a bare root prefix as /", () => {
    // The length > 1 guard: stripping the trailing slash off "/" would leave "".
    expect(parseProxyPathPrefixes("/", ["/x"])).toEqual(["/"]);
  });
});

describe("stripProxyPrefix", () => {
  it("maps the bare prefix to the root", () => {
    expect(stripProxyPrefix("/api", "/api")).toBe("/");
  });

  it("strips the prefix from a path below it", () => {
    expect(stripProxyPrefix("/api/health", "/api")).toBe("/health");
    expect(stripProxyPrefix("/api/watch/history?limit=5", "/api")).toBe("/watch/history?limit=5");
  });

  it("strips the prefix from a bare-prefix URL carrying a query string", () => {
    // Used to return null — the check required a slash after the prefix — so
    // the URL reached routing as "/api?x=1" and 404'd.
    expect(stripProxyPrefix("/api?x=1", "/api")).toBe("/?x=1");
  });

  it("strips the prefix from a bare-prefix URL carrying a fragment", () => {
    expect(stripProxyPrefix("/api#top", "/api")).toBe("/#top");
  });

  it("refuses a prefix that only matches as a substring", () => {
    // The reason a boundary is checked at all rather than a bare startsWith.
    expect(stripProxyPrefix("/apiary", "/api")).toBeNull();
    expect(stripProxyPrefix("/api-docs", "/api")).toBeNull();
  });

  it("refuses an unrelated path", () => {
    expect(stripProxyPrefix("/health", "/api")).toBeNull();
  });

  it("is case-sensitive, as request targets are", () => {
    expect(stripProxyPrefix("/API/health", "/api")).toBeNull();
  });
});

describe("normalizeProxyPath", () => {
  it("uses the first prefix that applies", () => {
    expect(normalizeProxyPath("/cataloggy/health", ["/api", "/cataloggy"])).toBe("/health");
  });

  it("passes a URL under no prefix through unchanged", () => {
    expect(normalizeProxyPath("/health", ["/api"])).toBe("/health");
  });

  it("returns the root for a bare prefix rather than falling through", () => {
    // "/" is truthy, but a falsiness check here would be one refactor away from
    // returning "/api" — the URL the caller was trying to normalize.
    expect(normalizeProxyPath("/api", ["/api"])).toBe("/");
  });

  it("leaves a path alone when no prefixes are configured", () => {
    expect(normalizeProxyPath("/api/health", [])).toBe("/api/health");
  });
});

describe("parseTrustProxy", () => {
  it("trusts nothing when unset, so request.ip is the socket address", () => {
    // Not `false`: Fastify's own default is what "undefined" leaves in place,
    // and the two are not the same value to hand it.
    expect(parseTrustProxy(undefined)).toBeUndefined();
    expect(parseTrustProxy("")).toBeUndefined();
  });

  it('reads "true" and "false" as the booleans Fastify takes', () => {
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy(" true ")).toBe(true);
    expect(parseTrustProxy("false")).toBe(false);
  });

  it("reads anything else as the list of proxies to trust", () => {
    expect(parseTrustProxy("172.16.0.0/12")).toEqual(["172.16.0.0/12"]);
    expect(parseTrustProxy("172.16.0.0/12, 10.0.0.5")).toEqual(["172.16.0.0/12", "10.0.0.5"]);
  });

  it("drops empty entries from a trailing or doubled comma", () => {
    expect(parseTrustProxy("10.0.0.5,,")).toEqual(["10.0.0.5"]);
  });

  it("does not treat a list containing 'true' as the boolean", () => {
    // "true" only means "trust the whole chain" when it is the entire value; a
    // list is a list, and an entry that matches no address trusts no one.
    expect(parseTrustProxy("10.0.0.5,true")).toEqual(["10.0.0.5", "true"]);
  });

  it("is whitespace-only-safe, which is what a blank compose default produces", () => {
    expect(parseTrustProxy("   ")).toEqual([]);
  });
});
