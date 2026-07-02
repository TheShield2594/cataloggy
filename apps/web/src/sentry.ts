import * as Sentry from "@sentry/react";

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

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    initialScope: { tags: { service: "web" } },
    // Error tracking only — no performance tracing or session replay, to
    // keep this a lightweight, privacy-conscious opt-in for self-hosted
    // deployments.
    tracesSampleRate: 0,
  });
}

export { Sentry };
