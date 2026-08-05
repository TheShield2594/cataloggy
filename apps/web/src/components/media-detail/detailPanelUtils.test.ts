import { describe, expect, it } from "vitest";
import { formatRuntime, statusColor } from "./detailPanelUtils";

describe("formatRuntime", () => {
  it("keeps sub-hour runtimes in minutes", () => {
    expect(formatRuntime(0)).toBe("0m");
    expect(formatRuntime(42)).toBe("42m");
    expect(formatRuntime(59)).toBe("59m");
  });

  it("drops the minutes part on a whole number of hours", () => {
    expect(formatRuntime(60)).toBe("1h");
    expect(formatRuntime(120)).toBe("2h");
  });

  it("shows hours and minutes together otherwise", () => {
    expect(formatRuntime(61)).toBe("1h 1m");
    expect(formatRuntime(152)).toBe("2h 32m");
  });
});

describe("statusColor", () => {
  it("always returns a themed chip rather than a raw tint", () => {
    for (const status of ["Returning Series", "Ended", "Planned", "Released", ""]) {
      expect(statusColor(status)).toContain("status-chip");
      // A hard-coded -400/-500 tint is what made these unreadable on the light
      // theme; every status has to come from a --status-* token now.
      expect(statusColor(status)).not.toMatch(/-\d00\b/);
    }
  });

  it("marks running shows as ok", () => {
    expect(statusColor("Returning Series")).toContain("status-chip--ok");
    expect(statusColor("Ongoing")).toContain("status-chip--ok");
  });

  it("marks finished shows as bad", () => {
    expect(statusColor("Ended")).toContain("status-chip--bad");
    expect(statusColor("Canceled")).toContain("status-chip--bad");
    expect(statusColor("Cancelled")).toContain("status-chip--bad");
  });

  it("marks upcoming titles as warn", () => {
    expect(statusColor("In Production")).toContain("status-chip--warn");
    expect(statusColor("Planned")).toContain("status-chip--warn");
  });

  it("is case-insensitive", () => {
    expect(statusColor("ENDED")).toBe(statusColor("ended"));
    expect(statusColor("returning series")).toBe(statusColor("Returning Series"));
  });

  it("falls back to the neutral chip for anything unrecognised", () => {
    expect(statusColor("Released")).toBe("status-chip");
    expect(statusColor("")).toBe("status-chip");
  });
});
