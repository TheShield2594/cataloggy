import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GhostLoader } from "./GhostLoader";

/**
 * Every area the 14x14 template in index.css names and expects to be filled.
 * Transcribed from the stylesheet rather than imported from the component, so
 * that renaming an area in one place without the other fails here.
 *
 * an5 and an14 are named by the template but deliberately left empty — they
 * are the gaps between the ghost's trailing wisps — so they are absent below.
 */
const EXPECTED_AREAS = [
  "top0", "top1", "top2", "top3", "top4",
  "st0", "st1", "st2", "st3", "st4", "st5",
  "an1", "an2", "an3", "an4", "an6", "an7", "an8", "an9",
  "an10", "an11", "an12", "an13", "an15", "an16", "an17", "an18",
];

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

    // Spelled out rather than counted. A cell whose area name is misspelled is
    // placed nowhere and paints nothing, but it still leaves 27 unique values
    // that are neither an5 nor an14 — so the count and the gap checks below
    // pass while a chunk of the ghost is missing. Only naming the set catches
    // that.
    expect([...placed].sort()).toEqual([...EXPECTED_AREAS].sort());
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed).toHaveLength(27);
    expect(placed).not.toContain("an5");
    expect(placed).not.toContain("an14");
  });
});
