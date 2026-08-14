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
 *
 * None of that holds without a service worker, and there is no service worker
 * on an insecure origin — which is what the README's `http://192.168.x.x:7002`
 * quickstart is. Promising "saved data" there points at a cache that was never
 * allowed to exist, so the copy switches to what is actually true.
 */
export function OfflineBanner() {
  const online = useOnline();
  const cached = window.isSecureContext;

  // The live region stays mounted; only its contents come and go. Returning null
  // while online meant the region arrived *with* the message already inside it,
  // and a region created in the same paint as its content announces nothing —
  // the assistive technology has nothing to compare against. CommandPalette and
  // SearchPage both carry comments about this exact hazard; the banner that
  // exists to say "what you are looking at may be stale" was silent for the
  // people least able to see it.
  return (
    <div role="status" aria-live="polite">
      {!online && (
        <div
          className="glass-surface overlay-dialog sticky top-[76px] z-20 mb-5 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm shadow-e2"
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
              {cached
                ? "— showing saved data. Anything you change now won’t be saved."
                : "— nothing is saved for offline use on this address, so pages will be empty until you’re back."}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
