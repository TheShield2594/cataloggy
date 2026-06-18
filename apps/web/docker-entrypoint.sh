#!/bin/sh
set -e

API_BASE_JSON=$(VITE_API_BASE="${VITE_API_BASE:-}" node -e 'console.log(JSON.stringify(process.env.VITE_API_BASE))')
printf 'window.__CATALOGGY_API_BASE__ = %s;\n' "$API_BASE_JSON" > /app/dist/config.js

exec "$@"
