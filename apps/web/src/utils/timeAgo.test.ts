import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeAgo, timeUntil } from "./timeAgo";

const NOW = new Date("2026-06-15T12:00:00.000Z");

/** A timestamp `seconds` before (negative) or after (positive) the frozen now. */
const offset = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();

describe("timeAgo / timeUntil", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("timeAgo", () => {
    it("reports anything under a minute as 'just now'", () => {
      expect(timeAgo(offset(0))).toBe("just now");
      expect(timeAgo(offset(-59))).toBe("just now");
    });

    it("switches to minutes at exactly 60 seconds", () => {
      expect(timeAgo(offset(-60))).toBe("1m ago");
      expect(timeAgo(offset(-119))).toBe("1m ago");
    });

    it("rolls over at each unit boundary", () => {
      expect(timeAgo(offset(-59 * 60))).toBe("59m ago");
      expect(timeAgo(offset(-60 * 60))).toBe("1h ago");
      expect(timeAgo(offset(-23 * 3600))).toBe("23h ago");
      expect(timeAgo(offset(-24 * 3600))).toBe("1d ago");
      expect(timeAgo(offset(-29 * 86400))).toBe("29d ago");
      expect(timeAgo(offset(-30 * 86400))).toBe("1mo ago");
    });

    it("counts a year as twelve 30-day months", () => {
      expect(timeAgo(offset(-359 * 86400))).toBe("11mo ago");
      expect(timeAgo(offset(-360 * 86400))).toBe("1y ago");
      expect(timeAgo(offset(-800 * 86400))).toBe("2y ago");
    });

    it("treats future timestamps as 'just now' rather than negative counts", () => {
      expect(timeAgo(offset(3600))).toBe("just now");
    });
  });

  describe("timeUntil", () => {
    it("reports anything under a minute away as 'soon'", () => {
      expect(timeUntil(offset(0))).toBe("soon");
      expect(timeUntil(offset(59))).toBe("soon");
    });

    it("formats the largest whole unit remaining", () => {
      expect(timeUntil(offset(60))).toBe("in 1m");
      expect(timeUntil(offset(3 * 3600))).toBe("in 3h");
      expect(timeUntil(offset(10 * 86400))).toBe("in 10d");
      expect(timeUntil(offset(45 * 86400))).toBe("in 1mo");
    });

    it("treats past timestamps as 'soon' rather than negative counts", () => {
      expect(timeUntil(offset(-3600))).toBe("soon");
    });
  });
});
