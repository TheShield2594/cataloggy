import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  profile: { findMany: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "22222222-2222-4222-8222-222222222222";

const originalToken = process.env.API_TOKEN;

describe("stremio addon secret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_TOKEN = "test-api-token";
    prismaMock.profile.findMany.mockResolvedValue([{ id: PROFILE_ID }, { id: OTHER_PROFILE_ID }]);
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.API_TOKEN;
    else process.env.API_TOKEN = originalToken;
  });

  it("derives a stable, profile-specific secret", async () => {
    const { deriveStremioSecret } = await import("./stremio-secret.js");

    const secret = deriveStremioSecret(PROFILE_ID);

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveStremioSecret(PROFILE_ID)).toBe(secret);
    expect(deriveStremioSecret(OTHER_PROFILE_ID)).not.toBe(secret);
  });

  it("changes every secret when API_TOKEN is rotated, and derives none without one", async () => {
    const { deriveStremioSecret } = await import("./stremio-secret.js");
    const before = deriveStremioSecret(PROFILE_ID);

    process.env.API_TOKEN = "rotated-api-token";
    expect(deriveStremioSecret(PROFILE_ID)).not.toBe(before);

    delete process.env.API_TOKEN;
    expect(deriveStremioSecret(PROFILE_ID)).toBeNull();
  });

  it("resolves a secret back to the profile it was derived for", async () => {
    const { deriveStremioSecret, resolveProfileFromStremioSecret } = await import("./stremio-secret.js");

    await expect(resolveProfileFromStremioSecret(deriveStremioSecret(OTHER_PROFILE_ID))).resolves.toBe(
      OTHER_PROFILE_ID
    );
  });

  it("rejects an unknown secret, and one minted under a different API_TOKEN", async () => {
    const { deriveStremioSecret, resolveProfileFromStremioSecret } = await import("./stremio-secret.js");
    const staleSecret = deriveStremioSecret(PROFILE_ID);

    await expect(resolveProfileFromStremioSecret("f".repeat(64))).resolves.toBeNull();

    process.env.API_TOKEN = "rotated-api-token";
    await expect(resolveProfileFromStremioSecret(staleSecret)).resolves.toBeNull();
  });

  it("rejects malformed candidates without querying profiles", async () => {
    const { resolveProfileFromStremioSecret } = await import("./stremio-secret.js");

    for (const candidate of [undefined, null, "", "../etc/passwd", "A".repeat(64), "a".repeat(63), 42]) {
      await expect(resolveProfileFromStremioSecret(candidate)).resolves.toBeNull();
    }
    expect(prismaMock.profile.findMany).not.toHaveBeenCalled();
  });

  it("recognises only secret-shaped addon paths as exempt from the token gate", async () => {
    const { isStremioSecretPath } = await import("./stremio-secret.js");
    const secret = "a".repeat(64);

    expect(isStremioSecretPath(`/addon/stremio/${secret}/manifest.json`)).toBe(true);
    expect(isStremioSecretPath(`/addon/stremio/${secret}/catalog/movie/my_watchlist_movies.json`)).toBe(true);
    expect(isStremioSecretPath(`/addon/stremio/${secret}?profileId=x`)).toBe(true);

    expect(isStremioSecretPath("/addon/stremio/manifest.json")).toBe(false);
    expect(isStremioSecretPath("/addon/stremio/catalog/movie/my_watchlist_movies.json")).toBe(false);
    expect(isStremioSecretPath("/addon/config")).toBe(false);
    expect(isStremioSecretPath(`/addon/stremio/${"a".repeat(63)}/manifest.json`)).toBe(false);
    expect(isStremioSecretPath(`/watch?next=/addon/stremio/${secret}/manifest.json`)).toBe(false);
  });
});
