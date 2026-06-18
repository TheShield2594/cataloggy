#!/bin/sh
set -e

cat > /app/dist/config.js <<EOF
window.__CATALOGGY_API_BASE__ = "${VITE_API_BASE:-}";
EOF

exec "$@"
