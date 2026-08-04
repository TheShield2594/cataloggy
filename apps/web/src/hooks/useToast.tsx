import { Check, Heart, Undo2, X } from "lucide-react";
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ToastAction = { label: string; onAction: () => void };

export type Toast = {
  id: number;
  message: string;
  type: "success" | "error" | "info";
  action?: ToastAction;
};

export type ShowToastOptions = { action?: ToastAction; duration?: number };

export type ShowToast = (message: string, type?: Toast["type"], options?: ShowToastOptions) => void;

let toastId = 0;

const MAX_VISIBLE_TOASTS = 3;
const DEFAULT_DURATION_MS = 3000;
// A toast carrying an Undo is the only way back from a destructive action, so
// it has to outlive the glance that notices the action happened at all.
const ACTION_DURATION_MS = 8000;

type ToastContextValue = {
  showToast: ShowToast;
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
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onAction();
                onDismiss(toast.id);
              }}
              className="ml-1 flex flex-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-claw-text transition-colors hover:bg-claw-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
            >
              <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
              {toast.action.label}
            </button>
          )}
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
  // Undo toasts are long-lived, so their dismiss timers are worth tracking:
  // acting on one (or closing it) should cancel the pending expiry rather than
  // leave a timer running against an id that is already gone.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback<ShowToast>((message, type = "success", options) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type, action: options?.action }]);
    const duration = options?.duration ?? (options?.action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS);
    timers.current.set(id, setTimeout(() => dismissToast(id), duration));
  }, [dismissToast]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

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
