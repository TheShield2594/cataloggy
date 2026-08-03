import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "22222222-2222-4222-8222-222222222222";

const prismaMock = {
  profile: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./profile-token.js", () => ({ verifyProfileToken: vi.fn(() => false) }));

class FakeReply {
  statusCode?: number;
  body?: unknown;
  code(code: number) {
    this.statusCode = code;
    return this;
  }
  send(payload: unknown) {
    this.body = payload;
    return this;
  }
}

const makeRequest = (profileId?: string): FastifyRequest =>
  ({ headers: profileId ? { "x-profile-id": profileId } : {} }) as unknown as FastifyRequest;

const loadProfileLib = async () => import("./profile.js");

describe("resolveProfile caching", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    // Each test re-imports the module, but the cache lives in ./cache.js, which
    // vitest also re-instantiates on resetModules — clear it anyway so ordering
    // between tests can never leak a hit.
    const { profileCacheClear } = await import("./cache.js");
    profileCacheClear();
  });

  it("resolves a profile by id and reuses it for later requests", async () => {
    prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, pinHash: null });
    const { resolveProfile } = await loadProfileLib();

    for (let i = 0; i < 5; i++) {
      const request = makeRequest(PROFILE_ID);
      const reply = new FakeReply();
      await resolveProfile(request, reply as unknown as FastifyReply);
      expect(reply.statusCode).toBeUndefined();
      expect(request.profileId).toBe(PROFILE_ID);
    }

    expect(prismaMock.profile.findUnique).toHaveBeenCalledTimes(1);
  });

  it("collapses a parallel burst into one query, not one per request", async () => {
    // The dashboard's requests all arrive before the first lookup resolves, so a
    // plain read-through cache would let every one of them hit the database.
    let release: (value: { id: string; pinHash: null }) => void = () => {};
    prismaMock.profile.findUnique.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const { resolveProfile } = await loadProfileLib();

    const requests = Array.from({ length: 11 }, () => makeRequest(PROFILE_ID));
    const pending = Promise.all(
      requests.map((request) => resolveProfile(request, new FakeReply() as unknown as FastifyReply))
    );

    release({ id: PROFILE_ID, pinHash: null });
    await pending;

    expect(prismaMock.profile.findUnique).toHaveBeenCalledTimes(1);
    for (const request of requests) expect(request.profileId).toBe(PROFILE_ID);
  });

  it("caches the single-profile fallback probe as well", async () => {
    prismaMock.profile.findMany.mockResolvedValue([{ id: PROFILE_ID, pinHash: null }]);
    const { resolveProfile } = await loadProfileLib();

    for (let i = 0; i < 3; i++) {
      const request = makeRequest();
      await resolveProfile(request, new FakeReply() as unknown as FastifyReply);
      expect(request.profileId).toBe(PROFILE_ID);
    }

    expect(prismaMock.profile.findMany).toHaveBeenCalledTimes(1);
  });

  it("keeps enforcing the PIN gate on cached profiles", async () => {
    prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, pinHash: "hashed" });
    const { resolveProfile } = await loadProfileLib();

    for (let i = 0; i < 2; i++) {
      const request = makeRequest(PROFILE_ID);
      const reply = new FakeReply();
      await resolveProfile(request, reply as unknown as FastifyReply);
      expect(reply.statusCode).toBe(401);
      expect(request.profileId).toBeUndefined();
    }

    expect(prismaMock.profile.findUnique).toHaveBeenCalledTimes(1);
  });

  it("re-reads from the database after the cache is invalidated", async () => {
    prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, pinHash: null });
    const { resolveProfile, invalidateProfileCache } = await loadProfileLib();

    await resolveProfile(makeRequest(PROFILE_ID), new FakeReply() as unknown as FastifyReply);
    expect(prismaMock.profile.findUnique).toHaveBeenCalledTimes(1);

    // A PIN was added to the profile out of band; the mutation route invalidates.
    invalidateProfileCache();
    prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, pinHash: "hashed" });

    const reply = new FakeReply();
    await resolveProfile(makeRequest(PROFILE_ID), reply as unknown as FastifyReply);

    expect(prismaMock.profile.findUnique).toHaveBeenCalledTimes(2);
    expect(reply.statusCode).toBe(401);
  });

  it("does not cache unknown profile ids", async () => {
    prismaMock.profile.findUnique.mockResolvedValue(null);
    const { resolveProfile } = await loadProfileLib();

    for (let i = 0; i < 2; i++) {
      const reply = new FakeReply();
      await resolveProfile(makeRequest(OTHER_PROFILE_ID), reply as unknown as FastifyReply);
      expect(reply.statusCode).toBe(404);
    }

    expect(prismaMock.profile.findUnique).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed profile id without touching the database", async () => {
    const { resolveProfile } = await loadProfileLib();
    const reply = new FakeReply();

    await resolveProfile(makeRequest("not-a-uuid"), reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(400);
    expect(prismaMock.profile.findUnique).not.toHaveBeenCalled();
  });
});
