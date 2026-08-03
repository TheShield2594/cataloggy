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

// A CSP source is a bare host/scheme expression: no whitespace (which would
// split it into two sources) and no `;` (which would start a new directive).
// Anything an operator adds via CSP_CONNECT_SRC_EXTRA is checked against this
// before it reaches the header.
const SOURCE_PATTERN = /^[A-Za-z0-9*.:/[\]_-]+$/;

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
  for (const entry of (extra ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (!SOURCE_PATTERN.test(trimmed)) {
      throw new Error(
        `CSP_CONNECT_SRC_EXTRA contains an invalid source: "${trimmed}". Use space-free origins or schemes, e.g. "https://api.example.com,https://sentry.example.com".`
      );
    }
    add(originOf(trimmed) ?? trimmed);
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
