import { WifiOff } from "lucide-react";
import { useOnline } from "../hooks/useOnline";

/**
 * The service worker serves API reads stale-while-revalidate so the installed
 * PWA keeps working off the LAN it talks to. That is the point, but it means a
 * dashboard rendered entirely from cache is indistinguishable from a live one —
 * a title marked watched on another device simply isn't there, with nothing to
 * explain why. This is that explanation.
 *
 * Sticky rather than fixed: it sits under the app header and above the page's
 * own content, so it stays in view while scrolling without the surrounding
 * layout having to reserve space for a banner that is usually absent.
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="overlay-dialog sticky top-[76px] z-20 mb-5 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm shadow-e2"
      style={{
        background: "var(--surface-strong)",
        border: "1px solid var(--border-strong)",
        color: "var(--text)",
      }}
    >
      <WifiOff className="h-4 w-4 flex-none" aria-hidden="true" />
      <p>
        <span className="font-semibold">Offline</span>
        <span style={{ color: "var(--text-dim)" }}>
          {" "}
          — showing saved data. Anything you change now won&rsquo;t be saved.
        </span>
      </p>
    </div>
  );
}
