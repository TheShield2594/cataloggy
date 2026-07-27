import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintProfileToken, verifyProfileToken } from "./profile-token.js";

const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "22222222-2222-4222-8222-222222222222";

describe("profile-token", () => {
  beforeEach(() => {
    process.env.API_TOKEN = "test-signing-secret";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("verifies a freshly minted token for the same profile", () => {
    const token = mintProfileToken(PROFILE_A);
    expect(verifyProfileToken(token, PROFILE_A)).toBe(true);
  });

  it("rejects a token minted for a different profile", () => {
    const token = mintProfileToken(PROFILE_A);
    expect(verifyProfileToken(token, PROFILE_B)).toBe(false);
  });

  it("rejects a missing or malformed token", () => {
    expect(verifyProfileToken(undefined, PROFILE_A)).toBe(false);
    expect(verifyProfileToken("", PROFILE_A)).toBe(false);
    expect(verifyProfileToken("garbage", PROFILE_A)).toBe(false);
    expect(verifyProfileToken("v1.notanumber.sig", PROFILE_A)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = mintProfileToken(PROFILE_A);
    const tampered = `${token.slice(0, -1)}${token.slice(-1) === "a" ? "b" : "a"}`;
    expect(verifyProfileToken(tampered, PROFILE_A)).toBe(false);
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = mintProfileToken(PROFILE_A);
    // Advance beyond the 12h TTL.
    vi.setSystemTime(new Date("2026-01-01T13:00:00Z"));
    expect(verifyProfileToken(token, PROFILE_A)).toBe(false);
  });

  it("rejects a token signed under a different API_TOKEN (rotation invalidates)", () => {
    const token = mintProfileToken(PROFILE_A);
    process.env.API_TOKEN = "rotated-secret";
    expect(verifyProfileToken(token, PROFILE_A)).toBe(false);
  });
});
