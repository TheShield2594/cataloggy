import { describe, expect, it } from "vitest";
import { boundedInt, boundedNumber, isRecord, normalizeImdbId } from "./import-validation.js";

describe("normalizeImdbId", () => {
  it("accepts an IMDb id and trims it", () => {
    expect(normalizeImdbId("tt0111161")).toBe("tt0111161");
    expect(normalizeImdbId("  tt1  ")).toBe("tt1");
  });

  it("rejects anything that isn't one", () => {
    for (const value of ["", "0111161", "TT0111161", "tt", "tt12a", "tt-show", "../../etc/passwd", 42, null, undefined, {}]) {
      expect(normalizeImdbId(value)).toBeNull();
    }
  });
});

describe("boundedInt", () => {
  it("accepts whole numbers inside the range, from a number or a CSV cell", () => {
    expect(boundedInt(3, 0, 10)).toBe(3);
    expect(boundedInt("3", 0, 10)).toBe(3);
    expect(boundedInt(0, 0, 10)).toBe(0);
  });

  it("rejects fractions, non-numbers and out-of-range values", () => {
    expect(boundedInt(1.5, 0, 10)).toBeNull();
    expect(boundedInt("abc", 0, 10)).toBeNull();
    expect(boundedInt("", 0, 10)).toBeNull();
    expect(boundedInt(null, 0, 10)).toBeNull();
    expect(boundedInt(-1, 0, 10)).toBeNull();
    expect(boundedInt(11, 0, 10)).toBeNull();
  });

  it("never returns a value a 32-bit column can't hold, whatever the caller asks for", () => {
    expect(boundedInt(1e20, 0, Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(boundedInt(2_147_483_648, 0, Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(boundedInt(2_147_483_647, 0, Number.MAX_SAFE_INTEGER)).toBe(2_147_483_647);
  });

  it("rejects the non-finite values Number.isFinite exists to catch", () => {
    expect(boundedInt(Number.NaN, 0, 10)).toBeNull();
    expect(boundedInt(Number.POSITIVE_INFINITY, 0, 10)).toBeNull();
  });
});

describe("boundedNumber", () => {
  it("allows fractions inside the range", () => {
    expect(boundedNumber(7.5, 0, 10)).toBe(7.5);
    expect(boundedNumber("7.5", 0, 10)).toBe(7.5);
  });

  it("rejects values outside it and anything non-finite", () => {
    expect(boundedNumber(1e20, 0, 10)).toBeNull();
    expect(boundedNumber(-0.5, 0, 10)).toBeNull();
    expect(boundedNumber(Number.NaN, 0, 10)).toBeNull();
    expect(boundedNumber(undefined, 0, 10)).toBeNull();
  });
});

describe("isRecord", () => {
  it("separates plain objects from the array elements that used to crash on .name", () => {
    expect(isRecord({ name: "Faves" })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("nope")).toBe(false);
    expect(isRecord(7)).toBe(false);
  });
});
