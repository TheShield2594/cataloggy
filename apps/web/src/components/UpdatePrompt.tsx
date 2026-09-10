import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";
import { RefreshCw, X } from "lucide-react";
import { tellServiceWorkerWhereTheApiIs } from "../api";
import { useExitAnimation } from "../hooks/useExitAnimation";

/**
 * How often an installed app asks whether there is a newer build.
 *
 * An hour is short enough that an update lands the same evening it is published
 * and long enough to be invisible: 24 conditional requests a day against a
 * server the user owns.
 */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// registerType is "prompt" (see vite.config.ts) rather than "autoUpdate" —
// a new service worker install/reload is surfaced here instead of silently
// taking over, since an unannounced reload can drop in-progress state (e.g.
// a check-in) on TV/remote-control UIs where that's harder to notice/recover from.
export function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const { exiting, requestClose, onExitAnimationEnd, reset } = useExitAnimation(() => setNeedRefresh(false));

  useEffect(() => {
    let updateCheck: ReturnType<typeof setInterval> | undefined;
    // Registration resolves on its own schedule, so `onRegisteredSW` can fire
    // after this effect has been torn down — a StrictMode double-mount is the
    // reliable way to see it. `clearInterval` in the cleanup has nothing to
    // clear at that point, and the callback then arms an hourly
    // `registration.update()` that outlives the component that owns it.
    let disposed = false;

    const update = registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedRefresh(true),
      onRegisteredSW: (_swUrl, registration) => {
        if (disposed) return;

        // The worker can only cache API responses it can recognise, and the API
        // base it compares against is a runtime value this page resolves — the
        // container's config.js, or a per-device override the worker cannot read.
        void tellServiceWorkerWhereTheApiIs();

        // The browser looks for a new worker on navigation, and an installed PWA
        // is the one thing that may never navigate: a household leaves it
        // resident for weeks, which is the entire point of installing it, and it
        // sits on whatever build it was launched with. `prompt` updates cannot
        // be prompted for if nothing ever checks.
        //
        // Nothing happens on a check that finds no update — a conditional
        // request for one script — so the cost of asking hourly is one 304.
        if (!registration) return;
        updateCheck = setInterval(() => {
          // An update check while the device is offline is a fetch that can only
          // fail, and a failed one puts a console error in front of a
          // self-hoster whose install is working perfectly.
          if (navigator.onLine === false) return;
          void registration.update();
        }, UPDATE_CHECK_INTERVAL_MS);
      },
      // Registration fails outright on an insecure origin, which is exactly
      // what the README's `http://192.168.x.x:7002` quickstart is — and with no
      // handler here it failed silently, taking offline caching, install and
      // push with it and leaving nothing in the console to explain why. The
      // secure-context case gets its own line because "SecurityError" alone
      // sends people looking for a bug in Cataloggy.
      onRegisterError: (error) => {
        if (!window.isSecureContext) {
          console.warn(
            "Cataloggy: service worker not registered — this page isn't a secure context. " +
              "Offline caching, install and push notifications need https:// or localhost. " +
              "See the README's \"Install as a PWA\" section.",
            error
          );
          return;
        }
        console.error("Cataloggy: service worker registration failed.", error);
      }
    });
    setUpdateSW(() => update);
    return () => {
      disposed = true;
      clearInterval(updateCheck);
    };
  }, []);

  // A later update can raise the prompt again after a dismissal; clear the
  // previous exit state so it doesn't render already-exiting.
  useEffect(() => {
    if (needRefresh) reset();
  }, [needRefresh, reset]);

  if (!needRefresh) return null;

  return (
    // The max-sm offset clears the mobile tab bar the same way ToastContainer
    // does, safe-area included since the nav accounts for it too. The max-width
    // and wrapping keep the row inside a 320px viewport — a single-line flex
    // row of copy + Reload + dismiss is wider than that and would otherwise
    // run off both edges.
    <div
      role="status"
      // `overlay-fade`, not `overlay-dialog`: this element centers itself with
      // -translate-x-1/2, and a running keyframe on `transform` would replace
      // that translate for its duration, lurching the banner sideways. Opacity
      // doesn't collide.
      className={`glass-surface overlay-fade fixed bottom-6 left-1/2 z-[110] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-xl border px-5 py-3.5 shadow-e2 max-sm:bottom-[calc(5rem+env(safe-area-inset-bottom))] ${exiting ? "overlay-exit" : ""}`}
      style={{ borderLeftWidth: "4px", borderColor: "var(--border)", background: "var(--bg-1)" }}
      onAnimationEnd={onExitAnimationEnd}
    >
      <RefreshCw aria-hidden="true" className="h-5 w-5 flex-none text-claw-text" />
      <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
        A new version of Cataloggy is available.
      </span>
      <button
        type="button"
        onClick={() => updateSW?.(true)}
        className="btn-primary btn-sm flex-none"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={requestClose}
        aria-label="Dismiss update notification"
        className="tap-target ml-1 flex-none rounded-md p-1 hover:bg-[var(--surface-strong)]"
        style={{ color: "var(--text-mute)" }}
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
