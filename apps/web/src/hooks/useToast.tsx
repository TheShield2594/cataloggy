import { Check, Heart, X } from "lucide-react";
import { createContext, ReactNode, useCallback, useContext, useState } from "react";

export type Toast = { id: number; message: string; type: "success" | "error" | "info" };

let toastId = 0;

const MAX_VISIBLE_TOASTS = 3;

type ToastContextValue = {
  showToast: (message: string, type?: Toast["type"]) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const visible = toasts.slice(-MAX_VISIBLE_TOASTS);
  const hiddenCount = toasts.length - visible.length;

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 sm:bottom-6 max-sm:bottom-20 max-sm:right-4">
      {hiddenCount > 0 && (
        <span className="self-end text-xs font-medium" style={{ color: "var(--text-mute)" }}>
          +{hiddenCount} more
        </span>
      )}
      {visible.map((toast) => (
        <div
          key={toast.id}
          className={`toast-enter flex items-center gap-3 rounded-xl border px-5 py-3.5 shadow-md ${
            toast.type === "success"
              ? "border-emerald-500/30"
              : toast.type === "error"
                ? "border-rose-500/30"
                : "border-claw-500/30"
          }`}
          style={{ borderLeftWidth: "4px", background: "var(--bg-1)" }}
        >
          {toast.type === "success" ? (
            <Check aria-hidden="true" className="h-5 w-5 flex-none text-emerald-500" />
          ) : toast.type === "error" ? (
            <X aria-hidden="true" className="h-5 w-5 flex-none text-rose-500" />
          ) : (
            <Heart aria-hidden="true" className="h-5 w-5 flex-none text-claw-text" />
          )}
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="ml-1 flex-none rounded-md p-1 hover:bg-[var(--surface-strong)]"
            style={{ color: "var(--text-mute)" }}
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => dismissToast(id), 3000);
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
