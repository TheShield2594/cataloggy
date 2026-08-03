import { describe, expect, it } from "vitest";
import { deriveServiceToken, matchesServiceToken } from "@cataloggy/shared";

const API_TOKEN = "secret-token";

describe("addon service token", () => {
  it("derives a stable, fixed-width value that is not the token itself", () => {
    const derived = deriveServiceToken(API_TOKEN);

    expect(derived).toBe(deriveServiceToken(API_TOKEN));
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(derived).not.toContain(API_TOKEN);
  });

  it("derives a different value for a different API token", () => {
    expect(deriveServiceToken(API_TOKEN)).not.toBe(deriveServiceToken("other-token"));
  });

  it("accepts the derived token and rejects everything else", () => {
    const derived = deriveServiceToken(API_TOKEN);

    expect(matchesServiceToken(derived, derived)).toBe(true);

    // The whole point: holding the raw API token is not enough. The browser has
    // it, so accepting it here would let any browser claim the addon's bucket.
    expect(matchesServiceToken(API_TOKEN, derived)).toBe(false);
    expect(matchesServiceToken(deriveServiceToken("other-token"), derived)).toBe(false);
    expect(matchesServiceToken("", derived)).toBe(false);
    expect(matchesServiceToken(undefined, derived)).toBe(false);
    // A repeated header arrives as string[]; must not throw.
    expect(matchesServiceToken([derived], derived)).toBe(false);
  });

  it("rejects everything when no token is configured", () => {
    expect(matchesServiceToken(deriveServiceToken(API_TOKEN), null)).toBe(false);
  });
});
