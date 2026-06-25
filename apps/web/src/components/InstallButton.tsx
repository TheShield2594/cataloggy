import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone));

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
  const [snoozed, setSnoozed] = useState(isSnoozed);

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

  if (isStandalone || snoozed || (!deferredPrompt && !isIOS)) {
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
          className="flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 py-2 text-xs font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900 transition-all"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline" aria-hidden="true">{label}</span>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss install prompt"
          className="flex items-center justify-center rounded-full border border-ink-200 bg-white p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition-all"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {showManualHint && (
        <p className="max-w-xs text-right text-xs text-ink-500">
          {isIOS
            ? "Safari: tap Share, then Add to Home Screen."
            : "Use your browser menu and choose Install app / Add to Home Screen."}
        </p>
      )}
    </div>
  );
}
