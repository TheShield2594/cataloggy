import { describe, expect, it } from "vitest";
import { buildMetaLine, formatRuntime, statusColor } from "./detailPanelUtils";

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

describe("buildMetaLine", () => {
  const full = {
    year: 2021,
    certification: "TV-MA",
    network: "Netflix",
    genres: ["Animation", "Action", "Adventure"],
  };

  it("orders the facts from most to least identifying", () => {
    expect(buildMetaLine(full)).toEqual(["2021", "TV-MA", "Netflix", "Animation, Action, Adventure"]);
  });

  it("collapses genres into one segment rather than one each", () => {
    // Three genre chips read as three more unrelated facts beside the year and
    // the certification; a comma-separated group reads as one.
    expect(buildMetaLine({ genres: ["Drama", "Crime"] })).toEqual(["Drama, Crime"]);
  });

  it("caps the genre list so the line stays shorter than the title", () => {
    expect(buildMetaLine({ genres: ["A", "B", "C", "D", "E"] })).toEqual(["A, B, C"]);
  });

  it("drops what a title doesn't have instead of leaving gaps", () => {
    expect(buildMetaLine({ year: 1999, certification: null, network: null, genres: [] })).toEqual(["1999"]);
    expect(buildMetaLine({})).toEqual([]);
  });

  it("treats blank strings as absent, so the line never opens on a separator", () => {
    expect(buildMetaLine({ certification: "   ", network: "", genres: ["  "] })).toEqual([]);
  });

  it("keeps a year of 0 out rather than printing it", () => {
    expect(buildMetaLine({ year: 0 })).toEqual([]);
  });
});
