import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GhostLoader } from "./GhostLoader";

describe("GhostLoader", () => {
  it("announces itself as a live status with a default label", () => {
    render(<GhostLoader />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("takes a caller-supplied label, so the wait can say what it is waiting on", () => {
    render(<GhostLoader label="Loading profiles…" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading profiles…");
  });

  it("hides the drawing from assistive tech, leaving only the label to read", () => {
    const { container } = render(<GhostLoader label="Loading…" />);

    expect(container.querySelector(".cg-ghost")).toHaveAttribute("aria-hidden", "true");
  });

  it("leaves the scale variable unset by default, so the stylesheet's 0.8 stands", () => {
    const { container } = render(<GhostLoader />);

    expect(container.querySelector<HTMLElement>(".cg-ghost")!.style.getPropertyValue("--cg-ghost-scale")).toBe("");
  });

  it("passes an explicit scale through as the CSS variable the stylesheet reads", () => {
    const { container } = render(<GhostLoader scale={0.5} />);

    expect(container.querySelector<HTMLElement>(".cg-ghost")!.style.getPropertyValue("--cg-ghost-scale")).toBe("0.5");
  });

  it("places every cell the grid template names, and no cell it does not", () => {
    const { container } = render(<GhostLoader />);
    const placed = [...container.querySelectorAll<HTMLElement>(".cg-ghost__cell")]
      .map((cell) => cell.style.gridArea);

    // an5 and an14 are named by the template but deliberately left empty —
    // they are the gaps between the ghost's trailing wisps.
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed).toHaveLength(27);
    expect(placed).not.toContain("an5");
    expect(placed).not.toContain("an14");
  });
});
