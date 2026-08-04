import { Check, Heart, Undo2, X } from "lucide-react";
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ToastAction = { label: string; onAction: () => void };

export type Toast = {
  id: number;
  message: string;
  type: "success" | "error" | "info";
  action?: ToastAction;
  // Set the moment a toast is dismissed, so it can play its exit animation
  // before the state update that actually removes it from the DOM.
  exiting?: boolean;
};

export type ShowToastOptions = { action?: ToastAction; duration?: number };

export type ShowToast = (message: string, type?: Toast["type"], options?: ShowToastOptions) => void;

let toastId = 0;

const MAX_VISIBLE_TOASTS = 3;
const DEFAULT_DURATION_MS = 3000;
// A toast carrying an Undo is the only way back from a destructive action, so
// it has to outlive the glance that notices the action happened at all.
const ACTION_DURATION_MS = 8000;
// An error toast is often the only copy of a failure reason — `Created "X", but
// couldn't add "Y" (reason)` and the like — and a sentence that long can't be
// read in the three seconds a "Saved" confirmation deserves.
const ERROR_DURATION_MS = 10000;
// Kept in step with the `.toast-exit` animation in index.css. The unmount is
// driven by animationend; this only backstops the cases where that event never
// arrives — a toast pushed out of the visible slice mid-exit, say, or a browser
// that skips the animation entirely.
const EXIT_ANIMATION_MS = 300;
const EXIT_FALLBACK_MS = EXIT_ANIMATION_MS + 200;

type ToastContextValue = {
  showToast: ShowToast;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function ToastContainer({
  toasts,
  onDismiss,
  onExited,
  onPause,
  onResume,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  onExited: (id: number) => void;
  onPause: (reason: PauseReason) => void;
  onResume: (reason: PauseReason) => void;
}) {
  const visible = toasts.slice(-MAX_VISIBLE_TOASTS);
  const hiddenCount = toasts.length - visible.length;
  const stackRef = useRef<HTMLDivElement>(null);

  // React's onFocus/onBlur are focusin/focusout, so they also fire when focus
  // merely moves from one button in the stack to another — Undo to Dismiss, say.
  // That is not focus leaving, and treating it as such would restart the timers
  // under a keyboard user mid-traversal.
  const staysWithinStack = (event: React.FocusEvent<HTMLDivElement>) =>
    event.relatedTarget instanceof Node && stackRef.current?.contains(event.relatedTarget) === true;

  return (
    <div
      ref={stackRef}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 sm:bottom-6 max-sm:bottom-20 max-sm:right-4"
      // Holding the pointer over the stack — or tabbing into it — stops the
      // clock on every toast in it. Reaching for Undo or the close button was
      // otherwise a race against a timer that could pull the button out from
      // under the click, and a long error message couldn't be re-read at all.
      onMouseEnter={() => onPause("hover")}
      onMouseLeave={() => onResume("hover")}
      onFocus={() => onPause("focus")}
      onBlur={(event) => { if (!staysWithinStack(event)) onResume("focus"); }}
    >
      {hiddenCount > 0 && (
        <span className="self-end text-xs font-medium" style={{ color: "var(--text-mute)" }}>
          +{hiddenCount} more
        </span>
      )}
      {visible.map((toast) => (
        <div
          key={toast.id}
          // The enter animation has long since finished by the time a toast is
          // dismissed, so swapping the class is what starts the exit; the
          // animationend it raises is what unmounts the toast.
          onAnimationEnd={toast.exiting ? () => onExited(toast.id) : undefined}
          // `pointer-events-none` while fading: a toast on its way out must not
          // take a second Undo click during the animation.
          className={`${toast.exiting ? "toast-exit pointer-events-none" : "toast-enter"} flex items-center gap-3 rounded-xl border px-5 py-3.5 shadow-md ${
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
              // `pointer-events-none` on the toast stops a second *click*, but a
              // button reached by keyboard is still focused and still fires on
              // Enter — so an Undo activated twice inside the exit animation
              // would run its action twice. Disabled closes that, and the guard
              // closes the gap between the click and the re-render that
              // disables the button.
              disabled={toast.exiting}
              onClick={() => {
                if (toast.exiting) return;
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
            disabled={toast.exiting}
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

// A toast's dismiss timer, tracked so it can be cancelled (acting on an Undo, or
// closing the toast, should not leave a timer running against an id that is
// already gone) and so it can be paused: `handle` is null while the stack is
// hovered, with `remaining` holding what was left of the countdown at that
// moment and `startedAt` marking when the current leg of it began.
type ToastTimer = {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
};

// Hover and focus hold the timers independently: clicking Undo puts focus in a
// stack the pointer is already over, and the blur that follows must not restart
// a countdown the pointer is still holding. Tracked as a set of reasons so the
// timers resume only when the last one lets go.
type PauseReason = "hover" | "focus";

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ToastTimer>());
  const exitTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const pauseReasons = useRef(new Set<PauseReason>());

  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer?.handle != null) clearTimeout(timer.handle);
    timers.current.delete(id);
  }, []);

  // The end of the line: the toast leaves the DOM here, once its exit animation
  // has played (or the fallback has given up waiting for one).
  const removeToast = useCallback((id: number) => {
    const exitTimer = exitTimers.current.get(id);
    if (exitTimer !== undefined) clearTimeout(exitTimer);
    exitTimers.current.delete(id);
    clearTimer(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, [clearTimer]);

  const dismissToast = useCallback((id: number) => {
    // Already on its way out — a second dismiss must not restart the animation
    // or queue a second fallback.
    if (exitTimers.current.has(id)) return;
    clearTimer(id);
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    exitTimers.current.set(id, setTimeout(() => removeToast(id), EXIT_FALLBACK_MS));
  }, [clearTimer, removeToast]);

  const showToast = useCallback<ShowToast>((message, type = "success", options) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type, action: options?.action }]);
    const duration =
      options?.duration ??
      (options?.action ? ACTION_DURATION_MS : type === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS);
    // A toast raised while the stack is already hovered starts out paused —
    // otherwise it would be the one toast the hover doesn't hold still.
    timers.current.set(id, {
      handle: pauseReasons.current.size > 0 ? null : setTimeout(() => dismissToast(id), duration),
      remaining: duration,
      startedAt: Date.now(),
    });
  }, [dismissToast]);

  const pauseTimers = useCallback((reason: PauseReason) => {
    // Only the transition from "nothing holding" to "something holding" stops
    // the clock; a second reason arriving on top changes nothing.
    const wasRunning = pauseReasons.current.size === 0;
    pauseReasons.current.add(reason);
    if (!wasRunning) return;
    const now = Date.now();
    timers.current.forEach((timer) => {
      if (timer.handle == null) return;
      clearTimeout(timer.handle);
      timer.handle = null;
      timer.remaining = Math.max(0, timer.remaining - (now - timer.startedAt));
    });
  }, []);

  const resumeTimers = useCallback((reason: PauseReason) => {
    if (!pauseReasons.current.delete(reason)) return;
    if (pauseReasons.current.size > 0) return;
    const now = Date.now();
    timers.current.forEach((timer, id) => {
      if (timer.handle != null) return;
      timer.startedAt = now;
      timer.handle = setTimeout(() => dismissToast(id), timer.remaining);
    });
  }, [dismissToast]);

  // Dismissing the last toast while hovering it shrinks the stack to nothing
  // under the pointer, and a mouseleave for an element that is no longer there
  // is not something to count on. With the stack empty there is nothing left to
  // hold still, so drop the pause rather than let it outlive its cause and
  // freeze the next toast on screen indefinitely.
  useEffect(() => {
    if (toasts.length === 0) pauseReasons.current.clear();
  }, [toasts.length]);

  useEffect(() => {
    const pending = timers.current;
    const pendingExits = exitTimers.current;
    return () => {
      pending.forEach((timer) => {
        if (timer.handle != null) clearTimeout(timer.handle);
      });
      pending.clear();
      pendingExits.forEach((timer) => clearTimeout(timer));
      pendingExits.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
        onExited={removeToast}
        onPause={pauseTimers}
        onResume={resumeTimers}
      />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
