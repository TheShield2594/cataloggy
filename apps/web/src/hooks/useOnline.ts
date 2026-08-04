import { useEffect, useState } from "react";

/**
 * Tracks connectivity via `navigator.onLine` and the `online`/`offline` events.
 *
 * Read the result narrowly: `navigator.onLine` reports link-layer connectivity
 * only, so `false` means the device has no network at all — a claim worth acting
 * on — while `true` merely means it has *a* network, not that the API on it is
 * reachable. Wi-Fi that can't see the server still reads as online, which is why
 * the API-base error message in `api.ts` stays as the fallback for that case.
 */
export function useOnline(): boolean {
  // `!== false` rather than a truthy check: a browser without the property at
  // all should be treated as online, not permanently offline.
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // The connection can drop between the initial render and this effect
    // attaching, and that transition fires an event nobody is listening for
    // yet — so re-read the current value once the listeners are in place.
    setOnline(navigator.onLine !== false);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
