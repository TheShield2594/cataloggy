import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BODY_SIZE_MB,
  bodyTooLargeMessage,
  isBodyTooLargeError,
  mbToBytes,
  parseMaxBodySizeMb,
} from "./body-limit.js";

describe("parseMaxBodySizeMb", () => {
  it("defaults when unset or blank", () => {
    expect(parseMaxBodySizeMb(undefined)).toBe(DEFAULT_MAX_BODY_SIZE_MB);
    expect(parseMaxBodySizeMb("  ")).toBe(DEFAULT_MAX_BODY_SIZE_MB);
  });

  it("accepts values inside the supported range", () => {
    expect(parseMaxBodySizeMb("1")).toBe(1);
    expect(parseMaxBodySizeMb("64")).toBe(64);
    expect(parseMaxBodySizeMb("1024")).toBe(1024);
  });

  it("rejects non-numeric, out-of-range and negative values", () => {
    for (const raw of ["nonsense", "0", "-5", "2048", "Infinity"]) {
      expect(() => parseMaxBodySizeMb(raw)).toThrow(/MAX_BODY_SIZE_MB/);
    }
  });
});

describe("mbToBytes", () => {
  it("converts to whole bytes", () => {
    expect(mbToBytes(32)).toBe(33_554_432);
    expect(mbToBytes(1.5)).toBe(1_572_864);
  });
});

describe("isBodyTooLargeError", () => {
  it("recognises Fastify's body-limit error by code and by status", () => {
    expect(isBodyTooLargeError({ code: "FST_ERR_CTP_BODY_TOO_LARGE" })).toBe(true);
    expect(isBodyTooLargeError({ statusCode: 413 })).toBe(true);
  });

  it("leaves other errors alone", () => {
    expect(isBodyTooLargeError({ code: "FST_ERR_CTP_INVALID_JSON_BODY", statusCode: 400 })).toBe(false);
    expect(isBodyTooLargeError(new Error("boom"))).toBe(false);
    expect(isBodyTooLargeError(null)).toBe(false);
    expect(isBodyTooLargeError("413")).toBe(false);
  });
});

describe("bodyTooLargeMessage", () => {
  it("names the limit and the variable that changes it", () => {
    const message = bodyTooLargeMessage(32);
    expect(message).toContain("32 MB");
    expect(message).toContain("MAX_BODY_SIZE_MB");
  });
});
