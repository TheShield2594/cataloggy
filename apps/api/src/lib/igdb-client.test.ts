import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isIgdbConfigured } from "./igdb-client.js";

// `isIgdbConfigured` decides a status code — 503 "Games was never set up"
// versus 500 "something is broken" on `GET /games/search` — so the env reading
// itself is worth pinning rather than only mocking at the route.
describe("isIgdbConfigured", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is true only when both credentials are present", () => {
    process.env.TWITCH_CLIENT_ID = "id";
    process.env.TWITCH_CLIENT_SECRET = "secret";

    expect(isIgdbConfigured()).toBe(true);
  });

  it("is false when neither is set", () => {
    expect(isIgdbConfigured()).toBe(false);
  });

  it.each(["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"])("is false with only %s set", (name) => {
    process.env[name] = "value";

    expect(isIgdbConfigured()).toBe(false);
  });

  // A pair left as empty quotes in a compose file is the likeliest way to hold
  // "unset" — treating that as configured would send the request on to
  // `fromEnv()`, which rejects it, and the 500 this fix removes would be back.
  it("treats a whitespace-only value as unset", () => {
    process.env.TWITCH_CLIENT_ID = "   ";
    process.env.TWITCH_CLIENT_SECRET = "secret";

    expect(isIgdbConfigured()).toBe(false);
  });
});
