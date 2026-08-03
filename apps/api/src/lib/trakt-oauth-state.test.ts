import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  kV: { create: vi.fn(), deleteMany: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const STATE_PREFIX = "trakt:oauth:state:";

describe("trakt OAuth state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.kV.create.mockResolvedValue({});
    prismaMock.kV.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("mints a 256-bit state and persists it under its own key", async () => {
    const { createOAuthState } = await import("./trakt-oauth-state.js");

    const state = await createOAuthState();

    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(prismaMock.kV.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: `${STATE_PREFIX}${state}` }) })
    );
  });

  it("does not reuse a state between calls", async () => {
    const { createOAuthState } = await import("./trakt-oauth-state.js");

    expect(await createOAuthState()).not.toBe(await createOAuthState());
  });

  it("sweeps states older than the TTL when a new flow starts", async () => {
    const { createOAuthState, OAUTH_STATE_TTL_MS } = await import("./trakt-oauth-state.js");
    const before = Date.now();

    await createOAuthState();

    const sweep = prismaMock.kV.deleteMany.mock.calls[0][0];
    expect(sweep.where.key).toEqual({ startsWith: STATE_PREFIX });
    expect(sweep.where.updatedAt.lt.getTime()).toBeGreaterThanOrEqual(before - OAUTH_STATE_TTL_MS);
    expect(sweep.where.updatedAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - OAUTH_STATE_TTL_MS);
  });

  it("accepts a known, unexpired state and deletes it in the same step", async () => {
    prismaMock.kV.deleteMany.mockResolvedValue({ count: 1 });
    const { consumeOAuthState, OAUTH_STATE_TTL_MS } = await import("./trakt-oauth-state.js");
    const state = "a".repeat(64);

    await expect(consumeOAuthState(state)).resolves.toBe(true);

    const call = prismaMock.kV.deleteMany.mock.calls[0][0];
    expect(call.where.key).toBe(`${STATE_PREFIX}${state}`);
    expect(call.where.updatedAt.gte.getTime()).toBeLessThanOrEqual(Date.now() - OAUTH_STATE_TTL_MS + 1000);
  });

  it("rejects a state no row matches — the row is gone, unknown or expired", async () => {
    prismaMock.kV.deleteMany.mockResolvedValue({ count: 0 });
    const { consumeOAuthState } = await import("./trakt-oauth-state.js");

    await expect(consumeOAuthState("b".repeat(64))).resolves.toBe(false);
  });

  it("rejects missing or malformed states without touching the database", async () => {
    const { consumeOAuthState } = await import("./trakt-oauth-state.js");

    for (const candidate of [undefined, null, "", "not-hex", "A".repeat(64), "a".repeat(63), ["a".repeat(64)]]) {
      await expect(consumeOAuthState(candidate)).resolves.toBe(false);
    }
    expect(prismaMock.kV.deleteMany).not.toHaveBeenCalled();
  });
});
