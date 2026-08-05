import { describe, it, expect } from "vitest";
import { monthlyBarGeometry } from "./monthlyBars";

describe("monthlyBarGeometry", () => {
  it("gives the tallest month the full column", () => {
    const bar = monthlyBarGeometry(6, 14, 20);
    expect(bar.total).toBe(20);
    expect(bar.height).toBe(100);
  });

  it("scales a short month against the tallest one", () => {
    const bar = monthlyBarGeometry(4, 0, 20);
    expect(bar.height).toBe(20);
  });

  it("splits the stack between movies and episodes in proportion", () => {
    const bar = monthlyBarGeometry(5, 15, 20);
    expect(bar.movieHeight).toBeCloseTo(25);
    expect(bar.episodeHeight).toBeCloseTo(75);
  });

  it("keeps the two segments summing to the stack height", () => {
    // The label is positioned at `height`, so a stack whose segments drifted
    // from it would leave the number floating off the top of its own bar.
    for (const [movies, episodes] of [[1, 2], [7, 0], [0, 3], [13, 29]]) {
      const bar = monthlyBarGeometry(movies, episodes, 30);
      expect(bar.movieHeight + bar.episodeHeight).toBeCloseTo(bar.height);
    }
  });

  it("floors a barely-active month at a visible height", () => {
    // 1 of 400 is 0.25% — a hairline. The floor keeps it a mark.
    expect(monthlyBarGeometry(1, 0, 400).height).toBe(4);
  });

  it("marks an empty month as empty rather than short", () => {
    const bar = monthlyBarGeometry(0, 0, 20);
    expect(bar.total).toBe(0);
    expect(bar.height).toBe(2);
    expect(bar.movieHeight).toBe(0);
    expect(bar.episodeHeight).toBe(0);
  });

  it("does not divide by a zero maximum", () => {
    const bar = monthlyBarGeometry(3, 1, 0);
    expect(Number.isFinite(bar.height)).toBe(true);
    expect(bar.height).toBe(100);
  });

  it("never draws a bar taller than its column", () => {
    // A maximum below the month's own total would put the bar — and the label
    // positioned from the same number — outside the chart.
    expect(monthlyBarGeometry(30, 10, 5).height).toBe(100);
  });
});
