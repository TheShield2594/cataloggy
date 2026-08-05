/*
 * Installed-PWA detection, plus the viewport/gesture lockdown that only an
 * installed app should get.
 *
 * A phone browser hands a page gestures that suit a document and not an app:
 * pinch-to-zoom, double-tap-to-zoom, and a zoom-in on any focused field whose
 * text is under 16px. In a tab that is fine — the address bar, the tab strip
 * and the browser menu all say "this is a web page", and zooming out again is
 * a known gesture. In an installed PWA there is no chrome at all, so a stray
 * two-finger drag leaves the app sitting zoomed and off-centre with nothing
 * on screen explaining how to get back.
 *
 * So the lockdown is applied at runtime, only when the app is running
 * installed, rather than baked into the viewport meta in index.html: a browser
 * tab keeps pinch-zoom, which WCAG 1.4.4 expects and which OS-level zoom does
 * not replace. `data-display-mode` on <html> carries the same distinction into
 * CSS (see the touch block in index.css).
 */

type LegacyNavigator = Navigator & { standalone?: boolean };

// `display-mode` reflects the manifest's `display`, which is `standalone` here.
// The other two installed modes are matched anyway so that a launcher which
// downgrades the mode — or a later manifest change — doesn't quietly turn the
// lockdown off.
const INSTALLED_MODES = ["standalone", "fullscreen", "minimal-ui"] as const;

const VIEWPORT_BROWSER = "width=device-width, initial-scale=1.0, viewport-fit=cover";
const VIEWPORT_INSTALLED = `${VIEWPORT_BROWSER}, maximum-scale=1.0, user-scalable=no`;

// Non-standard WebKit events, and the only way to stop a pinch on iOS: Safari
// honours `user-scalable=no` for home-screen apps, but a gesture that starts on
// a scrollable subtree can still reach the page zoom.
const GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const matchesMode = INSTALLED_MODES.some((mode) => window.matchMedia?.(`(display-mode: ${mode})`)?.matches);
  // iOS only started reporting `display-mode` for home-screen apps in 16.4;
  // `navigator.standalone` is the signal on everything older.
  return Boolean(matchesMode) || Boolean((window.navigator as LegacyNavigator).standalone);
}

const blockGesture = (event: Event) => event.preventDefault();

let gesturesBlocked = false;

function setGestureBlocking(blocked: boolean) {
  if (blocked === gesturesBlocked) return;
  gesturesBlocked = blocked;
  for (const name of GESTURE_EVENTS) {
    if (blocked) document.addEventListener(name, blockGesture, { passive: false });
    else document.removeEventListener(name, blockGesture);
  }
}

/** Reflect the current display mode into <html> and the viewport meta. */
export function applyDisplayMode(): boolean {
  const installed = isStandalone();
  document.documentElement.dataset.displayMode = installed ? "standalone" : "browser";
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute("content", installed ? VIEWPORT_INSTALLED : VIEWPORT_BROWSER);
  setGestureBlocking(installed);
  return installed;
}

/**
 * Subscribe to installed/browser transitions, returning an unsubscribe.
 *
 * Launching from the home screen is a fresh document, so most of the time the
 * mode is settled before anything runs. The exception is installing from an
 * open tab: Chrome moves the live document into the installed window without
 * reloading it, so anything that reads the mode has to be told, rather than
 * waiting for a next load that never comes.
 */
export function onDisplayModeChange(handler: () => void): () => void {
  const query = window.matchMedia?.("(display-mode: browser)");
  query?.addEventListener?.("change", handler);
  return () => query?.removeEventListener?.("change", handler);
}

/** Apply the mode now, and keep it applied across those transitions. */
export function watchDisplayMode(): () => void {
  applyDisplayMode();
  const unsubscribe = onDisplayModeChange(() => {
    applyDisplayMode();
  });
  return () => {
    unsubscribe();
    setGestureBlocking(false);
  };
}
