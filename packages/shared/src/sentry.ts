import * as Sentry from "@sentry/node";

export { Sentry };

// Shared bootstrap for the api and addon services. Opt-in via SENTRY_DSN;
// error tracking only — no performance tracing — to keep this a
// lightweight, privacy-conscious opt-in for self-hosted deployments.
export const initNodeSentry = (service: string): boolean => {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    initialScope: { tags: { service } },
    tracesSampleRate: 0,
  });
  return true;
};
