import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildConnectSrc, buildScriptSrc, renderServeConfig } from "./csp.mjs";
import { IMAGE_CDN_HOSTS } from "../src/image-cdn-hosts.mjs";

// Resolved from the Vitest root (apps/web) — the suite runs under jsdom, where
// `import.meta.url` is an http: URL rather than a file path.
const template = readFileSync(resolve(process.cwd(), "serve.template.json"), "utf8");

const cspOf = (serveConfig) =>
  JSON.parse(serveConfig).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;

// The artwork CDNs are unconditional, so every expectation about the rest of
// the directive is written against what precedes them.
const withoutImageCdns = (connectSrc) =>
  connectSrc
    .split(" ")
    .filter((source) => !IMAGE_CDN_HOSTS.has(source.replace(/^https:\/\//, "")))
    .join(" ");

describe("connect-src", () => {
  it("allows the app's own origin plus the configured API and addon origins", () => {
    const connectSrc = buildConnectSrc({
      apiBase: "https://cataloggy.example.com/api/",
      addonBase: "https://cataloggy.example.com/addon",
    });

    expect(withoutImageCdns(connectSrc)).toBe("'self' https://cataloggy.example.com");
  });

  it("keeps distinct hosts and ports apart", () => {
    const connectSrc = buildConnectSrc({
      apiBase: "http://192.168.1.25:7000",
      addonBase: "http://192.168.1.25:7001",
    });

    expect(withoutImageCdns(connectSrc)).toBe(
      "'self' http://192.168.1.25:7000 http://192.168.1.25:7001"
    );
  });

  // The regression this file exists to prevent a second time: the service
  // worker caches these hosts, which turns each poster load into a fetch from
  // the worker — and a fetch is checked against connect-src, not img-src. When
  // the two lists drifted, every poster in the app broke at once.
  it("allows every artwork CDN the service worker fetches", () => {
    const connectSrc = buildConnectSrc({ apiBase: "https://cataloggy.example.com" });

    for (const host of IMAGE_CDN_HOSTS) {
      expect(connectSrc.split(" ")).toContain(`https://${host}`);
    }
  });

  it("never widens to whole schemes — the wildcard this replaced allowed any host", () => {
    const connectSrc = buildConnectSrc({ apiBase: "http://192.168.1.25:7000" });

    expect(connectSrc).not.toMatch(/(^| )(https?|wss?):( |$)/);
    expect(connectSrc).not.toContain("https://evil.tld");
  });

  it("falls back to the same defaults api.ts uses when the env vars are unset", () => {
    expect(withoutImageCdns(buildConnectSrc())).toBe(
      "'self' http://localhost:7000 http://localhost:7001"
    );
    expect(withoutImageCdns(buildConnectSrc({ apiBase: "", addonBase: "   " }))).toBe(
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
    expect(withoutImageCdns(buildConnectSrc({ apiBase: "not a url" }))).toBe(
      "'self' http://localhost:7000 http://localhost:7001"
    );
  });

  it("keeps a wildcard host, which is a real origin", () => {
    expect(buildConnectSrc({ extra: "https://*.example.com" })).toContain("https://*.example.com");
  });

  it("refuses extras that would re-open the any-host hole or split the directive", () => {
    for (const extra of ["https:", "http:", "ws:", "wss:", "*", "https://ok.example; script-src 'unsafe-inline'"]) {
      expect(() => buildConnectSrc({ extra })).toThrow(/invalid origin/);
    }
  });
});

describe("script-src", () => {
  // A literal digest rather than one this file recomputes: the encoding is the
  // contract with the browser (sha256 of the exact body, base64, nothing
  // trimmed), so the test has to fail if the encoding changes.
  it("names each inline script by the hash of its exact body", () => {
    const scriptSrc = buildScriptSrc("<script>doSomething();</script>");

    expect(scriptSrc).toBe("'self' 'sha256-RFWPLDbv2BY+rCkDzsE+0fr8ylGr2R2faWMhq4lfEQc='");
  });

  it("leaves scripts the browser fetches by URL to 'self'", () => {
    expect(buildScriptSrc('<script src="/config.js"></script>')).toBe("'self'");
    // A `src` on a later attribute, and one with spaces around the `=`.
    expect(buildScriptSrc('<script defer src = "/x.js"></script>')).toBe("'self'");
  });

  // index.html explains in a comment why its script is inline rather than a
  // `<script src>` — and a scan that reads that prose as markup swallows the
  // real script into a match starting mid-comment, producing a hash for text
  // the browser never executes and none for the script that needed one.
  it("does not read script tags written inside a comment", () => {
    const html = "<!-- inline rather than a <script src>: it is faster -->\n<script>a();</script>";

    expect(buildScriptSrc(html)).toBe(buildScriptSrc("<script>a();</script>"));
  });

  // A second `<!--` inside a comment opens nothing — the comment still ends at
  // the first `-->`, and everything up to it is prose. Worth pinning, because
  // this is where a strip-the-comments-then-scan pass gets interesting.
  it("ends a comment where the browser ends it, not at a nested opener", () => {
    expect(buildScriptSrc("<!-- a <!-- b <script>evil();</script> -->")).toBe("'self'");
    expect(buildScriptSrc("<!-- a <!-- b --><script>c();</script>")).toBe(
      buildScriptSrc("<script>c();</script>")
    );
  });

  // A valueless `src` is still an external script — the body never runs.
  it("ignores a bare src attribute", () => {
    expect(buildScriptSrc("<script src></script>")).toBe("'self'");
  });

  it("hashes every inline script on the page, once each", () => {
    const twice = "<script>a();</script><script>b();</script><script>a();</script>";

    expect(buildScriptSrc(twice).split(" ")).toHaveLength(3);
  });

  it("has nothing to add for a page with no inline scripts", () => {
    expect(buildScriptSrc("<html><body></body></html>")).toBe("'self'");
    expect(buildScriptSrc("")).toBe("'self'");
  });
});

describe("serve.json rendering", () => {
  it("substitutes the placeholders and leaves the rest of the policy intact", () => {
    const rendered = renderServeConfig(
      template,
      "'self' http://192.168.1.25:7000",
      "'self' 'sha256-abc123='"
    );
    const csp = cspOf(rendered);

    expect(csp).toContain("connect-src 'self' http://192.168.1.25:7000;");
    expect(csp).toContain("script-src 'self' 'sha256-abc123=';");
    expect(csp).toContain("frame-ancestors 'none';");
    expect(csp).not.toContain("__CONNECT_SRC__");
    expect(csp).not.toContain("__SCRIPT_SRC__");
  });

  it("fails loudly if the template loses a placeholder", () => {
    expect(() => renderServeConfig('{"headers": []}', "'self'")).toThrow(/__CONNECT_SRC__/);
    expect(() => renderServeConfig(template.replaceAll("__SCRIPT_SRC__", "'self'"), "'self'")).toThrow(
      /__SCRIPT_SRC__/
    );
  });
});
