import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN?.trim();

export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    initialScope: { tags: { service: "api" } },
    // Error tracking only — no performance tracing, to keep this a
    // lightweight, privacy-conscious opt-in for self-hosted deployments.
    tracesSampleRate: 0,
  });
}

export { Sentry };
