import { useEffect, useState } from "react";
import { Download, ShieldAlert, X } from "lucide-react";
import { isStandalone, onDisplayModeChange } from "../utils/displayMode";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

const SNOOZE_KEY = "cataloggy:install-snooze-until";
const SNOOZE_DAYS = 14;

function isSnoozed() {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    return Date.now() < until;
  } catch {
    return false;
  }
}

function snoozeInstallPrompt() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // ignore storage errors (e.g. private browsing)
  }
}

export function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showManualHint, setShowManualHint] = useState(false);
  const [showOriginNotice, setShowOriginNotice] = useState(false);
  const [snoozed, setSnoozed] = useState(isSnoozed);
  // Held in state rather than read at render time: installing from an open tab
  // flips the mode without reloading the document, and nothing else re-renders
  // this, so an offer to install would sit in the installed app's own header.
  const [standalone, setStandalone] = useState(isStandalone);

  useEffect(() => onDisplayModeChange(() => setStandalone(isStandalone())), []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setShowManualHint(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (!showManualHint) return;
    const timer = window.setTimeout(() => setShowManualHint(false), 5000);
    return () => window.clearTimeout(timer);
  }, [showManualHint]);

  // Chrome only fires `beforeinstallprompt` on an installable — meaning secure —
  // origin, so on the `http://192.168.x.x:7002` address the README quickstart
  // hands out this component rendered nothing at all and no Android user ever
  // saw an install path, or a reason there wasn't one. iOS is excluded: Add to
  // Home Screen works there over plain http, so the button below still has
  // something to offer.
  const needsSecureOrigin = !deferredPrompt && !isIOS && !window.isSecureContext;

  if (standalone || snoozed || (!deferredPrompt && !isIOS && !needsSecureOrigin)) {
    return null;
  }

  const onInstall = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
      } catch (err) {
        console.error(err);
      } finally {
        setDeferredPrompt(null);
      }
      return;
    }

    setShowManualHint(true);
  };

  const onDismiss = () => {
    snoozeInstallPrompt();
    setSnoozed(true);
  };

  // Same shape and same dismiss as the install offer it stands in for — one
  // chip, an explanation on demand, and an X that snoozes it for a fortnight.
  if (needsSecureOrigin) {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowOriginNotice((open) => !open)}
            aria-expanded={showOriginNotice}
            aria-label="Why can't Cataloggy be installed?"
            className="flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-0)] px-3.5 py-2.5 text-xs font-medium text-[var(--text-mute)] transition-all duration-base hover:bg-[var(--surface-strong)] hover:text-[var(--text-dim)] sm:py-2"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span className="hidden sm:inline" aria-hidden="true">Install needs HTTPS</span>
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss install notice"
            className="flex items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--bg-0)] p-2.5 text-[var(--text-mute)] transition-all duration-base hover:bg-[var(--surface-strong)] hover:text-[var(--text-dim)] sm:p-2"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {showOriginNotice && (
          <p className="max-w-xs text-right text-xs" style={{ color: "var(--text-mute)" }}>
            Browsers only allow installing — and offline and notifications — from an{" "}
            <strong>https://</strong> address or localhost. Serve Cataloggy through a reverse proxy
            with a certificate to turn all three on.
          </p>
        )}
      </div>
    );
  }

  const label = isIOS && !deferredPrompt ? "Add to Home Screen" : "Install";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            void onInstall();
          }}
          aria-label={label === "Install" ? "Install Cataloggy" : label}
          className="flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-0)] px-3.5 py-2.5 text-xs font-medium text-[var(--text-dim)] transition-all duration-base hover:bg-[var(--surface-strong)] hover:text-[var(--text)] sm:py-2"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline" aria-hidden="true">{label}</span>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss install prompt"
          className="flex items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--bg-0)] p-2.5 text-[var(--text-mute)] transition-all duration-base hover:bg-[var(--surface-strong)] hover:text-[var(--text-dim)] sm:p-2"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {showManualHint && (
        <p className="max-w-xs text-right text-xs" style={{ color: "var(--text-mute)" }}>
          {isIOS
            ? "Safari: tap Share, then Add to Home Screen."
            : "Use your browser menu and choose Install app / Add to Home Screen."}
        </p>
      )}
    </div>
  );
}
