// Pre-built Docker images bake VITE_* vars in at image-build time, which
// doesn't work for self-hosters configuring via .env. Mirror the
// window.__CATALOGGY_API_BASE__ pattern from api.ts: docker-entrypoint.sh
// writes the runtime SENTRY_DSN value into dist/config.js on container start.
declare global {
  interface Window {
    __CATALOGGY_SENTRY_DSN__?: string;
  }
}

const dsn = (window.__CATALOGGY_SENTRY_DSN__ || import.meta.env.VITE_SENTRY_DSN || "").trim();

export const sentryEnabled = Boolean(dsn);

// @sentry/react is ~28 kB gzipped — close to a quarter of the entry bundle — and
// the DSN is an opt-in that most self-hosted installs never set. Imported
// statically, every visit downloaded and parsed an error reporter that would
// never report anything. It rides in its own chunk now, fetched only when a DSN
// is actually configured.
type SentryModule = typeof import("@sentry/react");

let sentryPromise: Promise<SentryModule | null> | null = null;

function loadSentry(): Promise<SentryModule | null> {
  if (!dsn) return Promise.resolve(null);
  sentryPromise ??= import("@sentry/react")
    .then((mod) => {
      mod.init({
        dsn,
        environment: import.meta.env.MODE,
        initialScope: { tags: { service: "web" } },
        // Error tracking only — no performance tracing or session replay, to
        // keep this a lightweight, privacy-conscious opt-in for self-hosted
        // deployments.
        tracesSampleRate: 0
      });
      return mod;
    })
    .catch(() => null);
  return sentryPromise;
}

/**
 * Reports an error to Sentry when a DSN is configured, and does nothing at all
 * otherwise. Safe to call before the SDK chunk has arrived: the report rides on
 * the load promise rather than being dropped, so an error thrown during startup
 * still lands once the chunk resolves.
 */
export function captureException(
  error: unknown,
  context?: Parameters<SentryModule["captureException"]>[1]
): void {
  if (!dsn) return;
  void loadSentry().then((mod) => mod?.captureException(error, context));
}

if (dsn) {
  // Warm the chunk once the browser goes idle, so the first error of a session
  // doesn't wait on the download — but never ahead of the app's own rendering.
  const warm = () => void loadSentry();
  if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 5000 });
  else setTimeout(warm, 2000);
}
