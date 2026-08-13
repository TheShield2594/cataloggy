import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
/** Headers of a caller acting as `PROFILE_ID`, the way the web client sends them. */
const ownProfile = { "x-profile-id": PROFILE_ID };
/**
 * How PINs were stored before the salted KDF. Fixtures still use it, because
 * an existing install's PINs are in exactly this shape and have to keep
 * working — see the legacy-hash tests below.
 */
const hashPin = (pin: string) => createHash("sha256").update(pin).digest("hex");
/** What a PIN written today looks like: `scrypt$N$r$p$salt$key`. */
const SCRYPT_HASH = expect.stringMatching(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);

const prismaMock = {
  profile: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), count: vi.fn(), delete: vi.fn(), update: vi.fn() },
  kV: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
};

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const resetMocks = () => {
  vi.clearAllMocks();
  prismaMock.kV.findUnique.mockResolvedValue(null);
  prismaMock.kV.upsert.mockResolvedValue({});
  prismaMock.kV.deleteMany.mockResolvedValue({});
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) =>
    callback({ ...prismaMock, $executeRaw: vi.fn() })
  );
};

const buildApp = (): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./profiles.js"));

describe("profiles routes", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("profile resolution / listing", () => {
    it("reports hasPin true/false based on pinHash presence", async () => {
      prismaMock.profile.findMany.mockResolvedValue([
        { id: "p1", name: "Alice", pinHash: "abc" },
        { id: "p2", name: "Bob", pinHash: null },
      ]);
      const app = await buildApp();

      const response = await app.inject({ method: "GET", url: "/profiles" });

      expect(response.statusCode).toBe(200);
      expect(response.json().profiles).toEqual([
        { id: "p1", name: "Alice", hasPin: true },
        { id: "p2", name: "Bob", hasPin: false },
      ]);
    });
  });

  describe("POST /profiles", () => {
    it("rejects a missing name", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/profiles", payload: {} });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a blank pin when explicitly provided", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/profiles", payload: { name: "Alice", pin: "  " } });
      expect(response.statusCode).toBe(400);
    });

    it("creates a profile without a pin", async () => {
      prismaMock.profile.create.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
      const app = await buildApp();

      const response = await app.inject({ method: "POST", url: "/profiles", payload: { name: "Alice" } });

      expect(response.statusCode).toBe(201);
      expect(response.json().profile).toEqual({ id: PROFILE_ID, name: "Alice", hasPin: false });
    });

    it("rejects a PIN shorter than the minimum length", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/profiles", payload: { name: "Alice", pin: "12" } });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/at least|between/i);
      expect(prismaMock.profile.create).not.toHaveBeenCalled();
    });

    it("creates a profile with a hashed pin", async () => {
      prismaMock.profile.create.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("1234") });
      const app = await buildApp();

      await app.inject({ method: "POST", url: "/profiles", payload: { name: "Alice", pin: "1234" } });

      expect(prismaMock.profile.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pinHash: SCRYPT_HASH }) })
      );
    });
  });

  describe("POST /profiles/:id/verify — PIN lockout behavior", () => {
    it("rejects a non-UUID id", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/profiles/not-a-uuid/verify", payload: {} });
      expect(response.statusCode).toBe(400);
    });

    it("returns 404 for an unknown profile", async () => {
      prismaMock.profile.findUnique.mockResolvedValue(null);
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: `/profiles/${PROFILE_ID}/verify`, payload: {} });
      expect(response.statusCode).toBe(404);
    });

    it("allows verification immediately when the profile has no PIN set", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: `/profiles/${PROFILE_ID}/verify`, payload: {} });
      expect(response.statusCode).toBe(200);
    });

    it("accepts the correct PIN and clears prior attempts", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("4321") });
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: `/profiles/${PROFILE_ID}/verify`,
        payload: { pin: "4321" },
      });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.kV.deleteMany).toHaveBeenCalled();
    });

    it("rejects an incorrect PIN and records a failed attempt", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("4321") });
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: `/profiles/${PROFILE_ID}/verify`,
        payload: { pin: "0000" },
      });

      expect(response.statusCode).toBe(401);
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it("verifies a PIN stored under the pre-scrypt hash and rewrites it in the new format", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("4321") });
      prismaMock.profile.update.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: "scrypt$..." });
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: `/profiles/${PROFILE_ID}/verify`,
        payload: { pin: "4321" },
      });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.profile.update).toHaveBeenCalledWith({
        where: { id: PROFILE_ID },
        data: { pinHash: SCRYPT_HASH },
      });
    });

    it("still verifies when rewriting the legacy hash fails", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("4321") });
      prismaMock.profile.update.mockRejectedValue(new Error("database is read-only"));
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: `/profiles/${PROFILE_ID}/verify`,
        payload: { pin: "4321" },
      });

      expect(response.statusCode).toBe(200);
    });

    it("leaves an already-scrypt hash alone on a successful verify", async () => {
      const { hashPin: scryptHashPin } = await import("../lib/pin-hash.js");
      prismaMock.profile.findUnique.mockResolvedValue({
        id: PROFILE_ID,
        name: "Alice",
        pinHash: await scryptHashPin("4321"),
      });
      const app = await buildApp();

      const response = await app.inject({
        method: "POST",
        url: `/profiles/${PROFILE_ID}/verify`,
        payload: { pin: "4321" },
      });

      expect(response.statusCode).toBe(200);
      expect(prismaMock.profile.update).not.toHaveBeenCalled();
    });

    it("locks out after MAX_PIN_ATTEMPTS (5) failures and returns 429 on the next attempt", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("4321") });

      // Simulate the KV row state machine across repeated failures.
      let kvState: { count: number; lockedUntil: string; lockouts?: number } | null = null;
      const txObj = {
        $executeRaw: vi.fn(),
        kV: {
          findUnique: vi.fn(async () => (kvState ? { value: JSON.stringify(kvState), updatedAt: new Date() } : null)),
          upsert: vi.fn(async ({ create, update }: { create?: { value: string }; update?: { value: string } }) => {
            const value = update?.value ?? create?.value;
            if (value) kvState = JSON.parse(value);
            return {};
          }),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txObj) => unknown) => callback(txObj));
      prismaMock.kV.findUnique.mockImplementation(async () =>
        kvState ? { value: JSON.stringify(kvState), updatedAt: new Date() } : null
      );

      const app = await buildApp();

      for (let i = 0; i < 5; i++) {
        const response = await app.inject({
          method: "POST",
          url: `/profiles/${PROFILE_ID}/verify`,
          payload: { pin: "wrong" },
        });
        expect(response.statusCode).toBe(401);
      }

      expect(kvState).not.toBeNull();
      expect(kvState!.lockedUntil).not.toBe("");

      const lockedResponse = await app.inject({
        method: "POST",
        url: `/profiles/${PROFILE_ID}/verify`,
        payload: { pin: "4321" },
      });

      expect(lockedResponse.statusCode).toBe(429);
      expect(lockedResponse.json()).toEqual(
        expect.objectContaining({ error: expect.stringContaining("Too many incorrect attempts") })
      );
    });

    it("makes each successive lockout longer instead of re-locking for the same five minutes", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("4321") });

      let kvState: { count: number; lockedUntil: string; lockouts?: number } | null = null;
      const txObj = {
        $executeRaw: vi.fn(),
        kV: {
          findUnique: vi.fn(async () => (kvState ? { value: JSON.stringify(kvState), updatedAt: new Date() } : null)),
          upsert: vi.fn(async ({ create, update }: { create?: { value: string }; update?: { value: string } }) => {
            const value = update?.value ?? create?.value;
            if (value) kvState = JSON.parse(value);
            return {};
          }),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txObj) => unknown) => callback(txObj));
      // getPinLockout reads the same row, but this test drives failures
      // directly, so report "not locked" and let each lockout land.
      prismaMock.kV.findUnique.mockResolvedValue(null);

      const app = await buildApp();

      const lockoutDurations: number[] = [];
      for (let round = 0; round < 3; round++) {
        for (let attempt = 0; attempt < 5; attempt++) {
          await app.inject({ method: "POST", url: `/profiles/${PROFILE_ID}/verify`, payload: { pin: "wrong" } });
        }
        lockoutDurations.push(new Date(kvState!.lockedUntil).getTime() - Date.now());
        // Wait the lockout out, as a griefer with the shared token would.
        kvState = { ...kvState!, lockedUntil: new Date(Date.now() - 1000).toISOString() };
      }

      expect(lockoutDurations[1]).toBeGreaterThan(lockoutDurations[0] * 1.5);
      expect(lockoutDurations[2]).toBeGreaterThan(lockoutDurations[1] * 1.5);
      expect(kvState!.lockouts).toBe(3);
    });
  });

  describe("PATCH /profiles/:id", () => {
    it("rejects a non-UUID id", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "PATCH", url: "/profiles/not-a-uuid", payload: { name: "Alice" } });
      expect(response.statusCode).toBe(400);
    });

    it("404s for an unknown profile", async () => {
      prismaMock.profile.findUnique.mockResolvedValue(null);
      const app = await buildApp();
      const response = await app.inject({ method: "PATCH", url: `/profiles/${PROFILE_ID}`, payload: { name: "Alice" } });
      expect(response.statusCode).toBe(404);
    });

    it("rejects an empty body (nothing to update)", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
      const app = await buildApp();
      const response = await app.inject({ method: "PATCH", url: `/profiles/${PROFILE_ID}`, payload: {} });
      expect(response.statusCode).toBe(400);
      expect(prismaMock.profile.update).not.toHaveBeenCalled();
    });

    it("rejects a blank name", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
      const app = await buildApp();
      const response = await app.inject({ method: "PATCH", url: `/profiles/${PROFILE_ID}`, payload: { name: "  " } });
      expect(response.statusCode).toBe(400);
    });

    it("renames a profile", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
      prismaMock.profile.update.mockResolvedValue({ id: PROFILE_ID, name: "Alicia", pinHash: null });
      const app = await buildApp();

      const response = await app.inject({ method: "PATCH", url: `/profiles/${PROFILE_ID}`, payload: { name: "Alicia" } });

      expect(response.statusCode).toBe(200);
      expect(response.json().profile).toEqual({ id: PROFILE_ID, name: "Alicia", hasPin: false });
      expect(prismaMock.profile.update).toHaveBeenCalledWith({
        where: { id: PROFILE_ID },
        data: { name: "Alicia" },
      });
    });

    it("sets a PIN and clears any prior lockout attempts", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
      prismaMock.profile.update.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("9999") });
      const app = await buildApp();

      const response = await app.inject({
        method: "PATCH",
        url: `/profiles/${PROFILE_ID}`,
        headers: ownProfile,
        payload: { pin: "9999" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().profile.hasPin).toBe(true);
      expect(prismaMock.profile.update).toHaveBeenCalledWith({
        where: { id: PROFILE_ID },
        data: { pinHash: SCRYPT_HASH },
      });
      expect(prismaMock.kV.deleteMany).toHaveBeenCalled();
    });

    it("removes a PIN when pin is explicitly null and the correct currentPin is given", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("1234") });
      prismaMock.profile.update.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
      const app = await buildApp();

      const response = await app.inject({
        method: "PATCH",
        url: `/profiles/${PROFILE_ID}`,
        payload: { pin: null, currentPin: "1234" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().profile.hasPin).toBe(false);
      expect(prismaMock.profile.update).toHaveBeenCalledWith({
        where: { id: PROFILE_ID },
        data: { pinHash: null },
      });
      expect(prismaMock.kV.deleteMany).toHaveBeenCalled();
    });

    it("rejects a new PIN shorter than the minimum length", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
      const app = await buildApp();
      const response = await app.inject({ method: "PATCH", url: `/profiles/${PROFILE_ID}`, payload: { pin: "1" } });

      expect(response.statusCode).toBe(400);
      expect(prismaMock.profile.update).not.toHaveBeenCalled();
    });

    it("rejects a blank pin string (use null to remove)", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
      const app = await buildApp();
      const response = await app.inject({ method: "PATCH", url: `/profiles/${PROFILE_ID}`, payload: { pin: "  " } });
      expect(response.statusCode).toBe(400);
      expect(prismaMock.profile.update).not.toHaveBeenCalled();
    });

    describe("changing/removing an existing PIN requires the current PIN", () => {
      it("rejects a PIN change with no currentPin provided", async () => {
        prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("1234") });
        const app = await buildApp();

        const response = await app.inject({ method: "PATCH", url: `/profiles/${PROFILE_ID}`, payload: { pin: "9999" } });

        expect(response.statusCode).toBe(401);
        expect(prismaMock.profile.update).not.toHaveBeenCalled();
      });

      it("rejects an incorrect currentPin and records a failed attempt", async () => {
        prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("1234") });
        const app = await buildApp();

        const response = await app.inject({
          method: "PATCH",
          url: `/profiles/${PROFILE_ID}`,
          payload: { pin: "9999", currentPin: "0000" },
        });

        expect(response.statusCode).toBe(401);
        expect(prismaMock.profile.update).not.toHaveBeenCalled();
        expect(prismaMock.$transaction).toHaveBeenCalled();
      });

      it("does not derive a hash for the new PIN when the currentPin is wrong", async () => {
        prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("1234") });

        // scrypt is deliberately expensive, so a rejected request must not buy
        // a derivation for a PIN that is never going to be stored.
        const actual = await vi.importActual<typeof import("../lib/pin-hash.js")>("../lib/pin-hash.js");
        const hashSpy = vi.fn(actual.hashPin);
        vi.doMock("../lib/pin-hash.js", () => ({ ...actual, hashPin: hashSpy }));

        try {
          const app = await buildApp();
          const response = await app.inject({
            method: "PATCH",
            url: `/profiles/${PROFILE_ID}`,
            payload: { pin: "9999", currentPin: "0000" },
          });

          expect(response.statusCode).toBe(401);
          expect(hashSpy).not.toHaveBeenCalled();
          expect(prismaMock.profile.update).not.toHaveBeenCalled();
        } finally {
          vi.doUnmock("../lib/pin-hash.js");
          vi.resetModules();
        }
      });

      it("changes the PIN when the correct currentPin is given", async () => {
        prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("1234") });
        prismaMock.profile.update.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("9999") });
        const app = await buildApp();

        const response = await app.inject({
          method: "PATCH",
          url: `/profiles/${PROFILE_ID}`,
          payload: { pin: "9999", currentPin: "1234" },
        });

        expect(response.statusCode).toBe(200);
        expect(prismaMock.profile.update).toHaveBeenCalledWith({
          where: { id: PROFILE_ID },
          data: { pinHash: SCRYPT_HASH },
        });
      });

      it("does not require currentPin when setting a PIN for the first time", async () => {
        prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
        prismaMock.profile.update.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("9999") });
        const app = await buildApp();

        const response = await app.inject({
          method: "PATCH",
          url: `/profiles/${PROFILE_ID}`,
          headers: ownProfile,
          payload: { pin: "9999" },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    // A first PIN takes no proof — there is nothing yet to prove — so it is the
    // one PIN change that has to be scoped to the caller's own profile.
    // Otherwise any holder of the shared token could PIN-lock a household
    // member out of their profile, and removing it would then need the PIN they
    // never chose.
    describe("setting a first PIN is scoped to the calling profile", () => {
      it("refuses a first PIN on a profile the caller isn't acting as", async () => {
        prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
        const app = await buildApp();

        const response = await app.inject({
          method: "PATCH",
          url: `/profiles/${PROFILE_ID}`,
          headers: { "x-profile-id": OTHER_PROFILE_ID },
          payload: { pin: "9999" },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().code).toBe("profile_not_active");
        expect(prismaMock.profile.update).not.toHaveBeenCalled();
      });

      // The header is optional on a single-profile install, where the only
      // profile there is is the one the caller is in.
      it("allows a first PIN with no header when only one profile exists", async () => {
        prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
        prismaMock.profile.findMany.mockResolvedValue([{ id: PROFILE_ID, pinHash: null }]);
        prismaMock.profile.update.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("9999") });
        const app = await buildApp();

        const response = await app.inject({ method: "PATCH", url: `/profiles/${PROFILE_ID}`, payload: { pin: "9999" } });

        expect(response.statusCode).toBe(200);
      });

      it("refuses a first PIN with no header once a second profile exists", async () => {
        prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
        prismaMock.profile.findMany.mockResolvedValue([
          { id: PROFILE_ID, pinHash: null },
          { id: OTHER_PROFILE_ID, pinHash: null },
        ]);
        const app = await buildApp();

        const response = await app.inject({ method: "PATCH", url: `/profiles/${PROFILE_ID}`, payload: { pin: "9999" } });

        expect(response.statusCode).toBe(403);
        expect(prismaMock.profile.update).not.toHaveBeenCalled();
      });

      // Changing one carries its own proof, so it stays available from anywhere
      // — including the household's shared "manage profiles" screen.
      it("still lets another profile change an existing PIN with the current one", async () => {
        prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("1234") });
        prismaMock.profile.update.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("9999") });
        const app = await buildApp();

        const response = await app.inject({
          method: "PATCH",
          url: `/profiles/${PROFILE_ID}`,
          headers: { "x-profile-id": OTHER_PROFILE_ID },
          payload: { pin: "9999", currentPin: "1234" },
        });

        expect(response.statusCode).toBe(200);
      });
    });
  });

  describe("DELETE /profiles/:id", () => {
    it("rejects deleting the last remaining profile", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice" });
      prismaMock.profile.count.mockResolvedValue(1);
      const app = await buildApp();

      const response = await app.inject({ method: "DELETE", url: `/profiles/${PROFILE_ID}` });

      expect(response.statusCode).toBe(400);
      expect(prismaMock.profile.delete).not.toHaveBeenCalled();
    });

    it("deletes a profile when more than one exists", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice" });
      prismaMock.profile.count.mockResolvedValue(2);
      const app = await buildApp();

      const response = await app.inject({ method: "DELETE", url: `/profiles/${PROFILE_ID}` });

      expect(response.statusCode).toBe(204);
      expect(prismaMock.profile.delete).toHaveBeenCalledWith({ where: { id: PROFILE_ID } });
    });

    describe("a PIN-protected profile requires proof of the PIN", () => {
      const lockedProfile = { id: PROFILE_ID, name: "Alice", pinHash: hashPin("1234") };

      beforeEach(() => {
        prismaMock.profile.findUnique.mockResolvedValue(lockedProfile);
        prismaMock.profile.count.mockResolvedValue(2);
        process.env.API_TOKEN = "test-api-token";
      });

      it("refuses a delete with no currentPin and records a failed attempt", async () => {
        const app = await buildApp();

        const response = await app.inject({ method: "DELETE", url: `/profiles/${PROFILE_ID}` });

        expect(response.statusCode).toBe(401);
        expect(prismaMock.profile.delete).not.toHaveBeenCalled();
        expect(prismaMock.$transaction).toHaveBeenCalled();
      });

      it("refuses an incorrect currentPin", async () => {
        const app = await buildApp();

        const response = await app.inject({
          method: "DELETE",
          url: `/profiles/${PROFILE_ID}`,
          payload: { currentPin: "0000" },
        });

        expect(response.statusCode).toBe(401);
        expect(prismaMock.profile.delete).not.toHaveBeenCalled();
      });

      it("deletes when the correct currentPin is given", async () => {
        const app = await buildApp();

        const response = await app.inject({
          method: "DELETE",
          url: `/profiles/${PROFILE_ID}`,
          payload: { currentPin: "1234" },
        });

        expect(response.statusCode).toBe(204);
        expect(prismaMock.profile.delete).toHaveBeenCalledWith({ where: { id: PROFILE_ID } });
      });

      it("deletes without a PIN when the caller holds this profile's access token", async () => {
        const { mintProfileToken } = await import("../lib/profile-token.js");
        const app = await buildApp();

        const response = await app.inject({
          method: "DELETE",
          url: `/profiles/${PROFILE_ID}`,
          headers: { "x-profile-token": mintProfileToken(PROFILE_ID) },
        });

        expect(response.statusCode).toBe(204);
      });

      it("ignores an access token minted for a different profile", async () => {
        const { mintProfileToken } = await import("../lib/profile-token.js");
        const app = await buildApp();

        const response = await app.inject({
          method: "DELETE",
          url: `/profiles/${PROFILE_ID}`,
          headers: { "x-profile-token": mintProfileToken("22222222-2222-4222-8222-222222222222") },
        });

        expect(response.statusCode).toBe(401);
        expect(prismaMock.profile.delete).not.toHaveBeenCalled();
      });

      it("returns 429 while the profile is locked out", async () => {
        prismaMock.kV.findUnique.mockResolvedValue({
          value: JSON.stringify({ count: 0, lockedUntil: new Date(Date.now() + 60_000).toISOString() }),
        });
        const app = await buildApp();

        const response = await app.inject({
          method: "DELETE",
          url: `/profiles/${PROFILE_ID}`,
          payload: { currentPin: "1234" },
        });

        expect(response.statusCode).toBe(429);
        expect(prismaMock.profile.delete).not.toHaveBeenCalled();
      });
    });
  });
});
