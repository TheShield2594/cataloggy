// Overwritten at container startup from the VITE_API_BASE environment
// variable (see docker-entrypoint.sh). Left blank for local dev so the
// build-time import.meta.env.VITE_API_BASE default applies instead.
window.__CATALOGGY_API_BASE__ = "";
