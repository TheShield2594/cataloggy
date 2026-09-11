import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { traktRedirectUri } from "./trakt-redirect-uri.js";

const ENV_KEYS = ["TRAKT_REDIRECT_URI", "CATALOGGY_API_PUBLIC"] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("traktRedirectUri", () => {
  it("prefers TRAKT_REDIRECT_URI when it is set", () => {
    process.env.TRAKT_REDIRECT_URI = "https://cataloggy.example.com/trakt/oauth/callback";
    process.env.CATALOGGY_API_PUBLIC = "https://ignored.example.com";
    expect(traktRedirectUri()).toBe("https://cataloggy.example.com/trakt/oauth/callback");
  });

  it("derives the callback from CATALOGGY_API_PUBLIC otherwise", () => {
    process.env.CATALOGGY_API_PUBLIC = "https://cataloggy.example.com";
    expect(traktRedirectUri()).toBe("https://cataloggy.example.com/trakt/oauth/callback");
  });

  it("falls back to localhost when neither is configured", () => {
    expect(traktRedirectUri()).toBe("http://localhost:7000/trakt/oauth/callback");
  });

  // The three call sites — status, authorize and the callback's token exchange
  // — must agree byte for byte or Trakt answers the exchange `invalid_grant`.
  it("is stable across calls", () => {
    process.env.CATALOGGY_API_PUBLIC = "https://cataloggy.example.com";
    expect(traktRedirectUri()).toBe(traktRedirectUri());
  });

  // Takes no argument, so there is no channel for a query parameter, header or
  // body to reach it — which is what rules out an open redirect through the
  // OAuth flow. A signature change here should be a deliberate one.
  it("takes no caller-supplied input", () => {
    expect(traktRedirectUri).toHaveLength(0);
  });
});
