import { useEffect, useState } from "react";

/**
 * Owns the ⌘K shortcut and the palette's open state.
 *
 * Split out from CommandPalette so the shortcut can be registered from the app
 * shell without pulling the palette's markup, search logic and result rows into
 * the entry bundle — the palette is closed on every cold start, and most
 * sessions never open it at all.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  // Escape is deliberately not handled here — CommandPalette registers it with
  // useEscapeKey so the palette takes its place in the layer stack instead of
  // closing alongside whatever is on top of it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Holding the shortcut down autorepeats, and a toggle on every repeat
        // flickers the palette open and shut until the key is released.
        if (e.repeat) return;
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}
