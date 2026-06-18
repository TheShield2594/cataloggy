import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const hashPin = (pin: string) => createHash("sha256").update(pin).digest("hex");

const prismaMock = {
  profile: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), count: vi.fn(), delete: vi.fn() },
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

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: profilesRoutes } = await import("./profiles.js");
  const app = Fastify();
  await app.register(profilesRoutes);
  await app.ready();
  return app;
};

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
      await app.close();
    });
  });

  describe("POST /profiles", () => {
    it("rejects a missing name", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/profiles", payload: {} });
      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it("rejects a blank pin when explicitly provided", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/profiles", payload: { name: "Alice", pin: "  " } });
      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it("creates a profile without a pin", async () => {
      prismaMock.profile.create.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
      const app = await buildApp();

      const response = await app.inject({ method: "POST", url: "/profiles", payload: { name: "Alice" } });

      expect(response.statusCode).toBe(201);
      expect(response.json().profile).toEqual({ id: PROFILE_ID, name: "Alice", hasPin: false });
      await app.close();
    });

    it("creates a profile with a hashed pin", async () => {
      prismaMock.profile.create.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("1234") });
      const app = await buildApp();

      await app.inject({ method: "POST", url: "/profiles", payload: { name: "Alice", pin: "1234" } });

      expect(prismaMock.profile.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pinHash: hashPin("1234") }) })
      );
      await app.close();
    });
  });

  describe("POST /profiles/:id/verify — PIN lockout behavior", () => {
    it("rejects a non-UUID id", async () => {
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: "/profiles/not-a-uuid/verify", payload: {} });
      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it("returns 404 for an unknown profile", async () => {
      prismaMock.profile.findUnique.mockResolvedValue(null);
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: `/profiles/${PROFILE_ID}/verify`, payload: {} });
      expect(response.statusCode).toBe(404);
      await app.close();
    });

    it("allows verification immediately when the profile has no PIN set", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: null });
      const app = await buildApp();
      const response = await app.inject({ method: "POST", url: `/profiles/${PROFILE_ID}/verify`, payload: {} });
      expect(response.statusCode).toBe(200);
      await app.close();
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
      await app.close();
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
      await app.close();
    });

    it("locks out after MAX_PIN_ATTEMPTS (5) failures and returns 429 on the next attempt", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice", pinHash: hashPin("4321") });

      // Simulate the KV row state machine across repeated failures.
      let kvState: { count: number; lockedUntil: string } | null = null;
      const txObj = {
        $executeRaw: vi.fn(),
        kV: {
          findUnique: vi.fn(async () => (kvState ? { value: JSON.stringify(kvState) } : null)),
          upsert: vi.fn(async ({ create, update }: { create?: { value: string }; update?: { value: string } }) => {
            const value = update?.value ?? create?.value;
            if (value) kvState = JSON.parse(value);
            return {};
          }),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txObj) => unknown) => callback(txObj));
      prismaMock.kV.findUnique.mockImplementation(async () =>
        kvState ? { value: JSON.stringify(kvState) } : null
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
      await app.close();
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
      await app.close();
    });

    it("deletes a profile when more than one exists", async () => {
      prismaMock.profile.findUnique.mockResolvedValue({ id: PROFILE_ID, name: "Alice" });
      prismaMock.profile.count.mockResolvedValue(2);
      const app = await buildApp();

      const response = await app.inject({ method: "DELETE", url: `/profiles/${PROFILE_ID}` });

      expect(response.statusCode).toBe(204);
      expect(prismaMock.profile.delete).toHaveBeenCalledWith({ where: { id: PROFILE_ID } });
      await app.close();
    });
  });
});
