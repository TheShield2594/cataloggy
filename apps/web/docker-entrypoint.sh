#!/bin/sh
set -e

API_BASE_JSON=$(VITE_API_BASE="${VITE_API_BASE:-}" node -e 'console.log(JSON.stringify(process.env.VITE_API_BASE))')
ADDON_BASE_JSON=$(VITE_ADDON_BASE="${VITE_ADDON_BASE:-}" node -e 'console.log(JSON.stringify(process.env.VITE_ADDON_BASE))')
SENTRY_DSN_JSON=$(SENTRY_DSN="${SENTRY_DSN:-}" node -e 'console.log(JSON.stringify(process.env.SENTRY_DSN))')
{
  printf 'window.__CATALOGGY_API_BASE__ = %s;\n' "$API_BASE_JSON"
  printf 'window.__CATALOGGY_ADDON_BASE__ = %s;\n' "$ADDON_BASE_JSON"
  printf 'window.__CATALOGGY_SENTRY_DSN__ = %s;\n' "$SENTRY_DSN_JSON"
} > /app/dist/config.js

# The CSP's connect-src names the API/addon/Sentry origins this container was
# configured with, so it is rendered here for the same reason config.js is —
# those values only exist at container start.
node /app/scripts/render-serve-json.mjs /app/serve.template.json /app/dist/serve.json

exec "$@"
