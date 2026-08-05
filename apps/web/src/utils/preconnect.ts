/**
 * Opens the connection to a cross-origin API host before the app's first
 * request needs it.
 *
 * The API base is a runtime value (window.__CATALOGGY_API_BASE__, written into
 * config.js at container start), so it can't be a static <link> in index.html
 * the way the TMDB image host is. Without this, the dashboard's opening burst of
 * requests all queue behind one DNS + TCP + TLS handshake — on a remote host
 * over a mobile link that is comfortably a few hundred milliseconds of nothing
 * on screen.
 *
 * Same-origin deployments (the API behind a path on the same host) need no hint:
 * that connection is already open, having just delivered the page.
 */
function addPreconnect(origin: string): void {
  if (document.head.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return;
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = origin;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

/**
 * Opens connections to the games artwork hosts.
 *
 * These are deliberately not in index.html alongside the TMDB one: they are only
 * ever needed on the games page, and three speculative handshakes competing with
 * the app's own JS on every cold start would cost more than they save. Called
 * when the page mounts, which still lands well ahead of the first cover loading.
 */
export function preconnectToGameArtwork(): void {
  addPreconnect("https://images.igdb.com");
  addPreconnect("https://media.steampowered.com");
}

export function preconnectToApi(apiBase: string): void {
  let origin: string;
  try {
    origin = new URL(apiBase, window.location.href).origin;
  } catch {
    // A malformed base is the request layer's problem to report, not something
    // to throw out of a speculative optimisation during startup.
    return;
  }
  if (origin === window.location.origin) return;

  // `request()` in api.ts uses fetch's default credentials mode, so its
  // cross-origin calls carry no cookies and land in the anonymous connection
  // pool. A credentialed preconnect would warm a pool they never touch.
  addPreconnect(origin);
}
