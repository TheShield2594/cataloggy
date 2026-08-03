import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";
import { RefreshCw, X } from "lucide-react";

// registerType is "prompt" (see vite.config.ts) rather than "autoUpdate" —
// a new service worker install/reload is surfaced here instead of silently
// taking over, since an unannounced reload can drop in-progress state (e.g.
// a check-in) on TV/remote-control UIs where that's harder to notice/recover from.
export function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedRefresh(true)
    });
    setUpdateSW(() => update);
  }, []);

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-[110] flex -translate-x-1/2 items-center gap-3 rounded-xl border px-5 py-3.5 shadow-md"
      style={{ borderLeftWidth: "4px", borderColor: "var(--border)", background: "var(--bg-1)" }}
    >
      <RefreshCw aria-hidden="true" className="h-5 w-5 flex-none text-claw-text" />
      <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
        A new version of Cataloggy is available.
      </span>
      <button
        type="button"
        onClick={() => updateSW?.(true)}
        className="flex-none rounded-md bg-claw-500 px-3 py-1.5 text-sm font-medium text-claw-on hover:bg-claw-600"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        aria-label="Dismiss update notification"
        className="ml-1 flex-none rounded-md p-1 hover:bg-[var(--surface-strong)]"
        style={{ color: "var(--text-mute)" }}
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
