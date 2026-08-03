// Builds the `connect-src` list for the CSP the `web` container serves.
//
// The app's own origin is not enough: the browser talks to the API and (for the
// manifest link) the addon service, both of which live on separate origins that
// are only known at container start — which is why the header is rendered from
// a template by `render-serve-json.mjs` rather than shipped as a literal. The
// alternative the app used to send, `connect-src 'self' http: https: ws: wss:`,
// allows fetch/WebSocket to *any* host, which defeats the exfiltration
// protection the README's Security section credits the CSP with providing for
// the localStorage-token tradeoff.

// Mirrors the fallbacks in `src/api.ts`, so an install that never set
// VITE_API_BASE/VITE_ADDON_BASE keeps working.
const DEFAULT_API_BASE = "http://localhost:7000";
const DEFAULT_ADDON_BASE = "http://localhost:7001";

const PLACEHOLDER = "__CONNECT_SRC__";

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
 * Substitutes the rendered `connect-src` into the serve.json template.
 *
 * @param {string} template raw contents of serve.template.json
 * @param {string} connectSrc value returned by `buildConnectSrc`
 * @returns {string} serve.json contents
 */
export const renderServeConfig = (template, connectSrc) => {
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`serve.json template is missing the ${PLACEHOLDER} placeholder`);
  }
  const rendered = template.replaceAll(PLACEHOLDER, connectSrc);
  // Fail here rather than serving a file `serve` would refuse to parse.
  JSON.parse(rendered);
  return rendered;
};
