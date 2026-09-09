import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressRuler, TICK_CEILING } from "./ProgressRuler";

const ticks = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[role="progressbar"] > span')];

describe("ProgressRuler", () => {
  it("draws one tick per countable unit, so a season reads as episodes rather than as a percentage", () => {
    const { container } = render(<ProgressRuler value={4} total={8} discrete label="4 of 8 episodes" />);

    expect(ticks(container)).toHaveLength(8);
  });

  it("fills exactly the units that are finished", () => {
    const { container } = render(<ProgressRuler value={3} total={6} discrete label="3 of 6 episodes" />);
    const filled = ticks(container).map((tick) => tick.style.background.includes("--accent-rgb"));

    expect(filled).toEqual([true, true, true, false, false, false]);
  });

  it("part-fills the unit in flight, and only that one", () => {
    const { container } = render(<ProgressRuler value={2} total={5} partial={0.4} discrete label="2 of 5 episodes" />);
    const inner = ticks(container).map((tick) => tick.querySelector<HTMLElement>("span")?.style.width ?? null);

    expect(inner).toEqual([null, null, "40%", null, null]);
  });

  it("drops the partial once every unit is finished, so a completed season has nothing left in flight", () => {
    const { container } = render(<ProgressRuler value={5} total={5} partial={0.6} discrete label="5 of 5 episodes" />);

    expect(container.querySelectorAll("span > span")).toHaveLength(0);
  });

  it("falls back to a continuous bar past the tick ceiling, where segments would be thinner than the gaps", () => {
    const { container } = render(
      <ProgressRuler value={10} total={TICK_CEILING + 1} discrete label="10 of 25 episodes" />
    );

    expect(ticks(container)).toHaveLength(0);
    expect(container.querySelector<HTMLElement>('[role="progressbar"] > div')?.style.width).toBe(
      `${(10 / (TICK_CEILING + 1)) * 100}%`
    );
  });

  it("uses the bar for units that are not countable, however few of them there are", () => {
    // Eight hours played out of twenty is under the ceiling, but hours are not
    // parts — ticking them would invent a granularity the number doesn't have.
    const { container } = render(<ProgressRuler value={8} total={20} label="8 of 20 hours played" />);
    const fill = container.querySelector<HTMLElement>('[role="progressbar"] > div');

    expect(container.querySelectorAll('[role="progressbar"] > span')).toHaveLength(0);
    expect(fill?.style.width).toBe("40%");
  });

  it("folds the partial into the bar's width, so continuous units lose no precision to the fallback", () => {
    const { container } = render(<ProgressRuler value={2} total={4} partial={0.5} label="halfway through unit 3" />);

    expect(container.querySelector<HTMLElement>('[role="progressbar"] > div')?.style.width).toBe("62.5%");
  });

  it("renders nothing when there is no total to measure against, rather than an empty track that reads as zero", () => {
    const { container } = render(<ProgressRuler value={3} total={0} discrete label="unknown" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("clamps a value past the total instead of drawing ticks that overflow the row", () => {
    const { container } = render(<ProgressRuler value={99} total={4} discrete label="4 of 4 episodes" />);
    const filled = ticks(container).map((tick) => tick.style.background.includes("--accent-rgb"));

    expect(filled).toEqual([true, true, true, true]);
  });

  it("announces whole units, not the fraction — the part-filled tick is not a fifth episode", () => {
    render(<ProgressRuler value={4} total={8} partial={0.9} discrete label="Season 3, 4 of 8 episodes watched" />);
    const bar = screen.getByRole("progressbar");

    expect(bar).toHaveAttribute("aria-valuenow", "4");
    expect(bar).toHaveAttribute("aria-valuemax", "8");
    expect(bar).toHaveAccessibleName("Season 3, 4 of 8 episodes watched");
  });

  it("leaves the accessibility tree where the row already writes the same numbers out in text", () => {
    render(<ProgressRuler value={4} total={8} discrete decorative />);

    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
