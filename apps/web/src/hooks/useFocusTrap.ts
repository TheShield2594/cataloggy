import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Marks everything outside `container` inert, and returns the undo.
 *
 * The Tab cycle below is only half of "modal". A screen reader in browse mode
 * moves by heading, landmark and line rather than by Tab, so every dialog in the
 * app used to sit on top of a page that could still be read straight through —
 * `aria-modal="true"` says otherwise, and `aria-modal` is a claim the browser does
 * not enforce. `inert` removes the background from the accessibility tree and from
 * hit-testing, which is the claim actually kept.
 *
 * It walks up from the container inerting siblings at each level rather than
 * inerting one root, because these overlays render inside the app tree: anything
 * containing the dialog cannot be inert, so only the things beside it on the way
 * up can be. That also handles a dialog opening over a dialog — the second
 * inerts the first, and closing it restores exactly what it changed and nothing a
 * layer below had already set.
 */
const inertBackground = (container: HTMLElement): (() => void) => {
  const undo: Array<() => void> = [];

  for (let node: HTMLElement = container; node !== document.body && node.parentElement; ) {
    const parent: HTMLElement = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      // Skipped deliberately: an already-inert sibling belongs to a layer below,
      // which will restore it itself, and an exempt one is a live region that has
      // to keep announcing from behind the dialog — see ToastContainer.
      if (
        sibling === node ||
        !(sibling instanceof HTMLElement) ||
        sibling.hasAttribute("inert") ||
        sibling.hasAttribute("data-overlay-exempt")
      ) {
        continue;
      }
      // The attribute rather than the IDL property. They drive the same
      // behaviour in a browser, but the attribute is the one that is actually
      // present in the DOM afterwards — so a layer above can see that a layer
      // below already inerted this element, and so the effect is observable to
      // tests rather than being an expando on an object jsdom doesn't implement.
      sibling.setAttribute("inert", "");
      undo.push(() => {
        sibling.removeAttribute("inert");
      });
    }
    node = parent;
  }

  return () => {
    for (const restore of undo) restore();
  };
};

/**
 * Traps Tab/Shift+Tab focus within the returned ref's subtree, makes everything
 * outside it inert, and restores focus to the previously focused element on
 * unmount. Intended for modal dialogs.
 */
export function useFocusTrap<T extends HTMLElement>(active = true) {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const restoreBackground = inertBackground(container);

    const getFocusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    if (!container.contains(document.activeElement)) {
      const focusable = getFocusable();
      (focusable[0] ?? container).focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      // Before the focus restore, not after: an inert element cannot take focus,
      // and the trigger that opened this dialog is out in the background.
      restoreBackground();
      previouslyFocused?.focus();
    };
  }, [active]);

  return containerRef;
}
