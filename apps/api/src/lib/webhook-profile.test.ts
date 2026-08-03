import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";

const prismaMock = {
  profile: { findUnique: vi.fn(), findFirst: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const profileMock = { getDefaultProfileId: vi.fn() };
vi.mock("./profile.js", () => profileMock);

const makeRequest = (query: Record<string, unknown> = {}): FastifyRequest =>
  ({
    query,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() },
  }) as unknown as FastifyRequest;

const VALID_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("resolveWebhookProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileMock.getDefaultProfileId.mockResolvedValue("profile-default");
  });

  it("uses the profile query parameter when it names an existing profile", async () => {
    prismaMock.profile.findUnique.mockResolvedValue({ id: VALID_UUID });
    const { resolveWebhookProfile } = await import("./webhook-profile.js");

    const result = await resolveWebhookProfile(makeRequest({ profile: VALID_UUID }), "Sam");

    expect(result).toEqual({ ok: true, profileId: VALID_UUID });
    // An explicit profile wins outright — the account name isn't consulted.
    expect(prismaMock.profile.findFirst).not.toHaveBeenCalled();
    expect(profileMock.getDefaultProfileId).not.toHaveBeenCalled();
  });

  it("rejects a malformed profile query parameter instead of falling back", async () => {
    const { resolveWebhookProfile } = await import("./webhook-profile.js");

    const result = await resolveWebhookProfile(makeRequest({ profile: "nope" }), "Sam");

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "The profile query parameter must be a valid UUID",
    });
    expect(profileMock.getDefaultProfileId).not.toHaveBeenCalled();
  });

  it("404s when the requested profile does not exist", async () => {
    prismaMock.profile.findUnique.mockResolvedValue(null);
    const { resolveWebhookProfile } = await import("./webhook-profile.js");

    const result = await resolveWebhookProfile(makeRequest({ profile: VALID_UUID }), null);

    expect(result).toEqual({ ok: false, status: 404, error: "Profile not found" });
    expect(profileMock.getDefaultProfileId).not.toHaveBeenCalled();
  });

  it("matches the media-server account name against profile names", async () => {
    prismaMock.profile.findFirst.mockResolvedValue({ id: "profile-sam" });
    const { resolveWebhookProfile } = await import("./webhook-profile.js");

    const result = await resolveWebhookProfile(makeRequest(), "  sam  ");

    expect(result).toEqual({ ok: true, profileId: "profile-sam" });
    expect(prismaMock.profile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: { equals: "sam", mode: "insensitive" } } })
    );
    expect(profileMock.getDefaultProfileId).not.toHaveBeenCalled();
  });

  it("falls back to the default profile when the account name matches nothing", async () => {
    prismaMock.profile.findFirst.mockResolvedValue(null);
    const { resolveWebhookProfile } = await import("./webhook-profile.js");

    const result = await resolveWebhookProfile(makeRequest(), "Nobody");

    expect(result).toEqual({ ok: true, profileId: "profile-default" });
  });

  it("falls back to the default profile when the payload carries no account name", async () => {
    const { resolveWebhookProfile } = await import("./webhook-profile.js");

    const result = await resolveWebhookProfile(makeRequest(), undefined);

    expect(result).toEqual({ ok: true, profileId: "profile-default" });
    expect(prismaMock.profile.findFirst).not.toHaveBeenCalled();
  });
});
