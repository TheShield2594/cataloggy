import { describe, expect, it } from "vitest";
import { parseBool, parseBoolStrict } from "./parse-bool.js";

describe("parseBool", () => {
  it("accepts the spellings a person actually types", () => {
    // The whole point: `=== "true"` read every one of these as "off".
    for (const yes of ["true", "TRUE", "True", " true ", "1", "yes", "Y", "on"]) {
      expect(parseBool(yes), yes).toBe(true);
    }
  });

  it("reads the negative spellings as false", () => {
    for (const no of ["false", "FALSE", "0", "no", "off", "", "   "]) {
      expect(parseBool(no), no).toBe(false);
    }
  });

  it("falls back when the variable is unset", () => {
    expect(parseBool(undefined)).toBe(false);
    expect(parseBool(null)).toBe(false);
    expect(parseBool(undefined, true)).toBe(true);
  });

  it("lands a typo on the default rather than flipping the switch", () => {
    // These are opt-in flags. Guessing "the user typed something, so they must
    // have meant yes" is how a misspelling silently turns a feature on.
    expect(parseBool("ture")).toBe(false);
    expect(parseBool("enabled")).toBe(false);
    expect(parseBool("enabled", true)).toBe(true);
  });
});

describe("parseBoolStrict", () => {
  it("distinguishes an explicit no from an unusable value", () => {
    expect(parseBoolStrict("false")).toBe(false);
    expect(parseBoolStrict("")).toBe(false);
    expect(parseBoolStrict("ture")).toBeNull();
    expect(parseBoolStrict(undefined)).toBeNull();
  });
});
