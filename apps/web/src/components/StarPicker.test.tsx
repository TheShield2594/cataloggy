import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StarPicker } from "./StarPicker";
import { fromStars, toStars } from "../utils/rating";

describe("StarPicker", () => {
  it("offers ten half-star values across five stars", () => {
    render(<StarPicker value={null} onRate={vi.fn()} />);

    // Five stars, each split in half: the same ten values the API stores.
    expect(screen.getAllByRole("button")).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Rate 0.5 out of 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rate 2.5 out of 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rate 5 out of 5" })).toBeInTheDocument();
  });

  it("reports the stored 1-10 value, not the star count", async () => {
    const onRate = vi.fn();
    render(<StarPicker value={null} onRate={onRate} />);

    await userEvent.click(screen.getByRole("button", { name: "Rate 3.5 out of 5" }));

    expect(onRate).toHaveBeenCalledWith(7);
  });

  it("shows the saved rating and offers it back for clearing", () => {
    render(<StarPicker value={9} onRate={vi.fn()} />);

    const current = screen.getByRole("button", {
      name: "Your rating: 4.5 out of 5. Activate to remove it",
    });
    expect(current).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("4.5/5")).toBeInTheDocument();
  });

  it("names what is being rated when given a subject", () => {
    render(<StarPicker value={null} onRate={vi.fn()} subject="Season 3" />);

    expect(screen.getByRole("button", { name: "Rate Season 3 4 out of 5" })).toBeInTheDocument();
  });

  it("does not fire while disabled", async () => {
    const onRate = vi.fn();
    render(<StarPicker value={null} onRate={onRate} disabled />);

    await userEvent.click(screen.getByRole("button", { name: "Rate 4 out of 5" }));

    expect(onRate).not.toHaveBeenCalled();
  });
});

describe("star scale", () => {
  it("round-trips every stored value without losing precision", () => {
    // The reason ratings stay stored out of ten: five stars in half steps is
    // the same ten values, so an imported 9 stays a 9 rather than collapsing
    // into a 10.
    for (let stored = 1; stored <= 10; stored++) {
      expect(fromStars(toStars(stored))).toBe(stored);
    }
  });
});
