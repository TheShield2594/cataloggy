import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPin, isValidPinFormat, MAX_PIN_LENGTH, MIN_PIN_LENGTH, needsRehash, pinMatches } from "./pin-hash.js";

const legacyHash = (pin: string) => createHash("sha256").update(pin).digest("hex");

describe("hashPin", () => {
  it("encodes the scrypt parameters alongside the salt and key", async () => {
    const hash = await hashPin("1234");
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  });

  it("salts, so the same PIN twice gives two different hashes", async () => {
    expect(await hashPin("1234")).not.toBe(await hashPin("1234"));
  });
});

describe("pinMatches", () => {
  it("accepts the PIN it was derived from and rejects any other", async () => {
    const hash = await hashPin("1234");
    expect(await pinMatches("1234", hash)).toBe(true);
    expect(await pinMatches("4321", hash)).toBe(false);
    expect(await pinMatches("", hash)).toBe(false);
  });

  it("still accepts a PIN stored under the pre-scrypt SHA-256 scheme", async () => {
    expect(await pinMatches("1234", legacyHash("1234"))).toBe(true);
    expect(await pinMatches("9999", legacyHash("1234"))).toBe(false);
  });

  it("returns false rather than throwing on a stored value it can't parse", async () => {
    expect(await pinMatches("1234", "")).toBe(false);
    expect(await pinMatches("1234", "not-a-hash")).toBe(false);
    expect(await pinMatches("1234", "scrypt$nope$8$1$aa$bb")).toBe(false);
    expect(await pinMatches("1234", "scrypt$16384$8$1$zz$bb")).toBe(false);
    // A cost so large the derivation itself fails must not become a 500.
    expect(await pinMatches("1234", "scrypt$1073741824$8$1$aabb$ccdd")).toBe(false);
  });
});

describe("needsRehash", () => {
  it("flags a legacy hash and leaves a current one alone", async () => {
    expect(needsRehash(legacyHash("1234"))).toBe(true);
    expect(needsRehash(await hashPin("1234"))).toBe(false);
  });

  it("flags a hash written at different scrypt cost parameters", async () => {
    const [prefix, n, r, p, salt, key] = (await hashPin("1234")).split("$");
    expect(needsRehash([prefix, Number(n) / 2, r, p, salt, key].join("$"))).toBe(true);
    expect(needsRehash([prefix, n, Number(r) + 1, p, salt, key].join("$"))).toBe(true);
    expect(needsRehash([prefix, n, r, Number(p) + 1, salt, key].join("$"))).toBe(true);
  });

  it("flags a malformed encoding rather than treating it as current", () => {
    expect(needsRehash("scrypt$nope$8$1$aa$bb")).toBe(true);
    expect(needsRehash("scrypt$")).toBe(true);
  });
});

describe("isValidPinFormat", () => {
  it("enforces the length floor and ceiling", () => {
    expect(isValidPinFormat("1".repeat(MIN_PIN_LENGTH - 1))).toBe(false);
    expect(isValidPinFormat("1".repeat(MIN_PIN_LENGTH))).toBe(true);
    expect(isValidPinFormat("1".repeat(MAX_PIN_LENGTH))).toBe(true);
    expect(isValidPinFormat("1".repeat(MAX_PIN_LENGTH + 1))).toBe(false);
  });
});
