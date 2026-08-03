import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildConnectSrc, renderServeConfig } from "./csp.mjs";

// Resolved from the Vitest root (apps/web) — the suite runs under jsdom, where
// `import.meta.url` is an http: URL rather than a file path.
const template = readFileSync(resolve(process.cwd(), "serve.template.json"), "utf8");

const cspOf = (serveConfig) =>
  JSON.parse(serveConfig).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;

describe("connect-src", () => {
  it("allows the app's own origin plus the configured API and addon origins", () => {
    const connectSrc = buildConnectSrc({
      apiBase: "https://cataloggy.example.com/api/",
      addonBase: "https://cataloggy.example.com/addon",
    });

    expect(connectSrc).toBe("'self' https://cataloggy.example.com");
  });

  it("keeps distinct hosts and ports apart", () => {
    const connectSrc = buildConnectSrc({
      apiBase: "http://192.168.1.25:7000",
      addonBase: "http://192.168.1.25:7001",
    });

    expect(connectSrc).toBe("'self' http://192.168.1.25:7000 http://192.168.1.25:7001");
  });

  it("never widens to whole schemes — the wildcard this replaced allowed any host", () => {
    const connectSrc = buildConnectSrc({ apiBase: "http://192.168.1.25:7000" });

    expect(connectSrc).not.toMatch(/(^| )(https?|wss?):( |$)/);
    expect(connectSrc).not.toContain("https://evil.tld");
  });

  it("falls back to the same defaults api.ts uses when the env vars are unset", () => {
    expect(buildConnectSrc()).toBe("'self' http://localhost:7000 http://localhost:7001");
    expect(buildConnectSrc({ apiBase: "", addonBase: "   " })).toBe(
      "'self' http://localhost:7000 http://localhost:7001"
    );
  });

  it("adds the Sentry ingest origin only when a DSN is configured", () => {
    expect(buildConnectSrc({ apiBase: "http://api.local:7000" })).not.toContain("ingest");
    expect(
      buildConnectSrc({
        apiBase: "http://api.local:7000",
        sentryDsn: "https://abc123@o1.ingest.sentry.io/456",
      })
    ).toContain("https://o1.ingest.sentry.io");
  });

  it("appends extra origins for browsers pointed at a different API base", () => {
    const connectSrc = buildConnectSrc({
      apiBase: "http://192.168.1.25:7000",
      addonBase: "http://192.168.1.25:7001",
      extra: "https://cataloggy.example.com, https://api.example.com/v1 ",
    });

    expect(connectSrc).toContain("https://cataloggy.example.com");
    expect(connectSrc).toContain("https://api.example.com");
  });

  it("ignores a malformed base rather than emitting it into the header", () => {
    expect(buildConnectSrc({ apiBase: "not a url" })).toBe("'self' http://localhost:7000 http://localhost:7001");
  });

  it("refuses an extra source that would inject another CSP directive", () => {
    expect(() =>
      buildConnectSrc({ extra: "https://ok.example; script-src 'unsafe-inline'" })
    ).toThrow(/invalid source/);
  });
});

describe("serve.json rendering", () => {
  it("substitutes the placeholder and leaves the rest of the policy intact", () => {
    const rendered = renderServeConfig(template, "'self' http://192.168.1.25:7000");
    const csp = cspOf(rendered);

    expect(csp).toContain("connect-src 'self' http://192.168.1.25:7000;");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("frame-ancestors 'none';");
    expect(csp).not.toContain("__CONNECT_SRC__");
  });

  it("fails loudly if the template loses its placeholder", () => {
    expect(() => renderServeConfig('{"headers": []}', "'self'")).toThrow(/__CONNECT_SRC__/);
  });
});
