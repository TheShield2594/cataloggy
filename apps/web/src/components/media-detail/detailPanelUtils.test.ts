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
  it("marks running shows green", () => {
    expect(statusColor("Returning Series")).toContain("text-green-400");
    expect(statusColor("Ongoing")).toContain("text-green-400");
  });

  it("marks finished shows rose", () => {
    expect(statusColor("Ended")).toContain("text-rose-400");
    expect(statusColor("Canceled")).toContain("text-rose-400");
    expect(statusColor("Cancelled")).toContain("text-rose-400");
  });

  it("marks upcoming titles amber", () => {
    expect(statusColor("In Production")).toContain("text-amber-400");
    expect(statusColor("Planned")).toContain("text-amber-400");
  });

  it("is case-insensitive", () => {
    expect(statusColor("ENDED")).toBe(statusColor("ended"));
    expect(statusColor("returning series")).toBe(statusColor("Returning Series"));
  });

  it("falls back to slate for anything unrecognised", () => {
    expect(statusColor("Released")).toContain("text-slate-400");
    expect(statusColor("")).toContain("text-slate-400");
  });
});
