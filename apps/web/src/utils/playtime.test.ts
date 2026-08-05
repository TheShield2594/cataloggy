import { describe, expect, it } from "vitest";
import { formatPlaytime } from "./playtime";

describe("formatPlaytime", () => {
  it("rounds to whole hours from ten hours up", () => {
    expect(formatPlaytime(87 * 60)).toBe("87h");
    expect(formatPlaytime(52 * 60 + 20)).toBe("52h");
    expect(formatPlaytime(16 * 60)).toBe("16h");
  });

  it("carries a decimal below ten hours only when there is one to carry", () => {
    expect(formatPlaytime(8 * 60)).toBe("8h");
    expect(formatPlaytime(8 * 60 + 30)).toBe("8.5h");
  });

  it("switches to minutes under an hour rather than showing 0.5h", () => {
    expect(formatPlaytime(45)).toBe("45m");
    expect(formatPlaytime(59)).toBe("59m");
    expect(formatPlaytime(60)).toBe("1h");
  });

  it("names the empty case, and lets the caller word it", () => {
    expect(formatPlaytime(0)).toBe("Unplayed");
    expect(formatPlaytime(-5)).toBe("Unplayed");
    expect(formatPlaytime(0, "Not played yet")).toBe("Not played yet");
  });
});
