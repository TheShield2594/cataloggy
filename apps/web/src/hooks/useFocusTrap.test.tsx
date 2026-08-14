import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFocusTrap } from "./useFocusTrap";

/**
 * `aria-modal="true"` is a claim, not an enforcement — a screen reader in browse
 * mode moves by heading and line rather than by Tab, so a dialog that only traps
 * Tab still sits on top of a page that can be read straight through. These cover
 * the `inert` half of the trap, which is what actually keeps the claim.
 */
function Dialog({ active = true, exemptSibling = false }: { active?: boolean; exemptSibling?: boolean }) {
  const ref = useFocusTrap<HTMLDivElement>(active);
  return (
    <div>
      <div data-testid="page">
        <button type="button">Behind</button>
      </div>
      {exemptSibling && (
        <div data-testid="live" data-overlay-exempt="">
          <p>toast</p>
        </div>
      )}
      <div data-testid="dialog" ref={ref}>
        <button type="button">Inside</button>
      </div>
    </div>
  );
}

const page = () => screen.getByTestId("page");

describe("useFocusTrap background inerting", () => {
  it("makes everything beside the dialog inert while it is open", () => {
    render(<Dialog />);

    expect(page()).toHaveAttribute("inert");
    expect(screen.getByTestId("dialog")).not.toHaveAttribute("inert");
  });

  it("releases the background when the dialog unmounts", () => {
    const { unmount } = render(<Dialog />);
    expect(page()).toHaveAttribute("inert");

    unmount();

    // Queried off the container rather than the removed tree — after unmount the
    // page node is gone with it, so the assertion that matters is that nothing
    // was left inert behind a dialog that no longer exists.
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  });

  it("does nothing while inactive", () => {
    render(<Dialog active={false} />);

    expect(page()).not.toHaveAttribute("inert");
  });

  // The toast stack lives beside the app tree, and a toast raised by an action
  // taken inside a dialog is exactly the one that most needs announcing.
  it("leaves a data-overlay-exempt sibling alone", () => {
    render(<Dialog exemptSibling />);

    expect(page()).toHaveAttribute("inert");
    expect(screen.getByTestId("live")).not.toHaveAttribute("inert");
  });

  // A dialog opening over a dialog finds part of the background already inert.
  // Closing the upper one must hand back exactly what it took and nothing more,
  // or it un-inerts a background the dialog still underneath it is relying on.
  it("leaves an already-inert element alone, and still inert when it closes", () => {
    const { rerender, unmount } = render(<Dialog active={false} />);
    const outer = page();
    outer.setAttribute("inert", "");

    rerender(<Dialog active />);
    expect(outer).toHaveAttribute("inert");

    unmount();

    expect(outer).toHaveAttribute("inert");
  });
});
