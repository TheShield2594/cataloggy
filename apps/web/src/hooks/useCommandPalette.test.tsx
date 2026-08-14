import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCommandPalette } from "./useCommandPalette";
import { useEscapeKey } from "./useEscapeKey";

let palette: ReturnType<typeof useCommandPalette>;

/** Stands in for any overlay that registers itself on the modal layer stack. */
function OpenOverlay() {
  useEscapeKey(() => {}, true);
  return null;
}

function Harness({ overlayOpen = false }: { overlayOpen?: boolean }) {
  palette = useCommandPalette();
  return overlayOpen ? <OpenOverlay /> : null;
}

const pressShortcut = (init: Partial<KeyboardEventInit> = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, ...init }));
  });

describe("useCommandPalette", () => {
  it("opens on the shortcut when nothing is layered over the page", () => {
    render(<Harness />);

    pressShortcut();

    expect(palette.open).toBe(true);
  });

  // The palette used to arrive on top of an open detail panel, leaving two
  // dialogs claiming aria-modal at once and the focus trap of the one underneath
  // in charge of the one above.
  it("does not open over an overlay that is already up", () => {
    render(<Harness overlayOpen />);

    pressShortcut();

    expect(palette.open).toBe(false);
  });

  it("still closes itself, since it is the top of the stack once open", () => {
    const { rerender } = render(<Harness />);
    pressShortcut();
    expect(palette.open).toBe(true);

    // The palette registers its own layer while open, so the guard has to let
    // the shortcut through in the closing direction or it becomes a one-way trip.
    rerender(<Harness overlayOpen />);
    pressShortcut();

    expect(palette.open).toBe(false);
  });

  it("ignores autorepeat, which would flicker it open and shut", () => {
    render(<Harness />);

    pressShortcut();
    pressShortcut({ repeat: true });

    expect(palette.open).toBe(true);
  });
});
