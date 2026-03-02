import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone));

export function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showManualHint, setShowManualHint] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setShowManualHint(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  if (isStandalone) {
    return null;
  }

  const onInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      return;
    }

    setShowManualHint(true);
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => {
          void onInstall();
        }}
        className="rounded-md border border-sky-400/60 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-200 hover:bg-sky-500/20"
      >
        Install Cataloggy
      </button>
      {showManualHint && (
        <p className="max-w-xs text-right text-xs text-slate-400">
          {isIOS
            ? "Safari: tap Share, then Add to Home Screen."
            : "Use your browser menu and choose Install app / Add to Home Screen."}
        </p>
      )}
    </div>
  );
}
