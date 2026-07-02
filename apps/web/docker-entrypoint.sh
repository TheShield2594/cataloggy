#!/bin/sh
set -e

API_BASE_JSON=$(VITE_API_BASE="${VITE_API_BASE:-}" node -e 'console.log(JSON.stringify(process.env.VITE_API_BASE))')
SENTRY_DSN_JSON=$(SENTRY_DSN="${SENTRY_DSN:-}" node -e 'console.log(JSON.stringify(process.env.SENTRY_DSN))')
{
  printf 'window.__CATALOGGY_API_BASE__ = %s;\n' "$API_BASE_JSON"
  printf 'window.__CATALOGGY_SENTRY_DSN__ = %s;\n' "$SENTRY_DSN_JSON"
} > /app/dist/config.js

exec "$@"
