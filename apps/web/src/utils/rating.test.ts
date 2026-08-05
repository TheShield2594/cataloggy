import { describe, expect, it } from "vitest";
import { formatRating, ratingLabel, RATING_MAX } from "./rating";

describe("formatRating", () => {
  it("keeps a meaningful decimal", () => {
    expect(formatRating(7.4)).toBe("7.4");
    expect(formatRating(4.5)).toBe("4.5");
  });

  it("drops a trailing .0 so whole scores don't look more precise than they are", () => {
    expect(formatRating(8)).toBe("8");
    expect(formatRating(8.0)).toBe("8");
    expect(formatRating(10)).toBe("10");
  });

  it("rounds to one decimal", () => {
    expect(formatRating(7.849)).toBe("7.8");
    expect(formatRating(7.86)).toBe("7.9");
  });
});

describe("ratingLabel", () => {
  it("names the scale, since the chips it labels are too small to show it", () => {
    expect(ratingLabel(8.4)).toBe(`Rated 8.4 out of ${RATING_MAX}`);
    expect(ratingLabel(5)).toBe("Rated 5 out of 10");
  });
});
