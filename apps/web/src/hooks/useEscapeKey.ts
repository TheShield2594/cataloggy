import { useEffect, useRef } from "react";

let stack: Array<() => void> = [];

/**
 * True while any overlay registered below is open.
 *
 * The stack is the app's only record of what is layered over the page, so it is
 * also the only thing a global shortcut can ask before putting something else on
 * top. Used by the ⌘K handler, which otherwise opened the palette over an open
 * detail panel.
 */
export const hasOpenModalLayer = (): boolean => stack.length > 0;

/**
 * Registers `onEscape` for the Escape key, but only the most recently
 * mounted handler (i.e. the topmost modal in a stack) actually fires.
 * Prevents nested modals (e.g. a sub-modal opened on top of a detail panel)
 * from all closing at once on a single Escape press.
 */
export function useEscapeKey(onEscape: () => void, active = true) {
  const callbackRef = useRef(onEscape);
  callbackRef.current = onEscape;

  useEffect(() => {
    if (!active) return;

    const entry = () => callbackRef.current();
    stack.push(entry);

    return () => {
      stack = stack.filter((e) => e !== entry);
    };
  }, [active]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || stack.length === 0) return;
      stack[stack.length - 1]();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}
