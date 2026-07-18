// Overwritten at container startup from the VITE_API_BASE / VITE_ADDON_BASE
// environment variables (see docker-entrypoint.sh). Left blank for local dev
// so the build-time import.meta.env defaults apply instead.
window.__CATALOGGY_API_BASE__ = "";
window.__CATALOGGY_ADDON_BASE__ = "";
