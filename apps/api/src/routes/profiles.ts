import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { mintProfileToken } from "../lib/profile-token.js";
import { invalidateProfileCache } from "../lib/profile.js";
import { UUID_V4_PATTERN } from "../lib/types.js";

const toSha256Digest = (value: string) => createHash("sha256").update(value).digest();

const hashPin = (pin: string) => toSha256Digest(pin).toString("hex");

const pinMatches = (pin: string, pinHash: string): boolean => {
  const incoming = toSha256Digest(pin);
  const expected = Buffer.from(pinHash, "hex");
  if (incoming.length !== expected.length) return false;
  return timingSafeEqual(incoming, expected);
};

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 5 * 60 * 1000;

const pinAttemptKey = (profileId: string) => `pinattempts:${profileId}`;

type PinAttemptData = { count: number; lockedUntil: string };

const getPinLockout = async (profileId: string): Promise<{ locked: boolean; retryAfterSec: number }> => {
  const row = await prisma.kV.findUnique({ where: { key: pinAttemptKey(profileId) } });
  if (!row) return { locked: false, retryAfterSec: 0 };

  try {
    const data = JSON.parse(row.value) as PinAttemptData;
    if (data.lockedUntil && new Date(data.lockedUntil).getTime() > Date.now()) {
      const retryAfterSec = Math.ceil((new Date(data.lockedUntil).getTime() - Date.now()) / 1000);
      return { locked: true, retryAfterSec };
    }
  } catch { /* invalid data — treat as not locked */ }

  return { locked: false, retryAfterSec: 0 };
};

const recordPinFailure = async (profileId: string): Promise<void> => {
  const key = pinAttemptKey(profileId);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Lock the row for the duration of this transaction so concurrent
    // attempts can't read the same stale count. If the row doesn't exist
    // yet, we create it first and then lock it via the upsert below — the
    // unique constraint on KV.key ensures only one row wins the race.
    await tx.$executeRaw`SELECT value FROM "KV" WHERE key = ${key} FOR UPDATE`;

    const row = await tx.kV.findUnique({ where: { key } });
    let data: PinAttemptData;

    if (row) {
      try {
        data = JSON.parse(row.value) as PinAttemptData;
        // If a previous lockout has expired, reset count
        if (data.lockedUntil && new Date(data.lockedUntil).getTime() <= Date.now()) {
          data = { count: 0, lockedUntil: "" };
        }
      } catch {
        data = { count: 0, lockedUntil: "" };
      }
    } else {
      data = { count: 0, lockedUntil: "" };
    }

    data.count += 1;
    if (data.count >= MAX_PIN_ATTEMPTS) {
      data.lockedUntil = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString();
      data.count = 0;
    }

    await tx.kV.upsert({
      where: { key },
      create: { key, value: JSON.stringify(data), updatedAt: now },
      update: { value: JSON.stringify(data), updatedAt: now },
    });
  });
};

const clearPinAttempts = async (profileId: string): Promise<void> => {
  await prisma.kV.deleteMany({ where: { key: pinAttemptKey(profileId) } });
};

const profilesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/profiles", async () => {
    const profiles = await prisma.profile.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, pinHash: true },
    });

    return {
      profiles: profiles.map((p) => ({ id: p.id, name: p.name, hasPin: p.pinHash != null })),
    };
  });

  app.post<{ Body: unknown }>("/profiles", async (request, reply) => {
    if (!request.body || typeof request.body !== "object") {
      return reply.code(400).send({ error: "name is required" });
    }

    const body = request.body as { name?: unknown; pin?: unknown };
    if (typeof body.name !== "string" || !body.name.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }

    if (body.pin !== undefined && (typeof body.pin !== "string" || !body.pin.trim())) {
      return reply.code(400).send({ error: "pin must be a non-empty string when provided" });
    }

    const name = body.name.trim();
    const pin = typeof body.pin === "string" ? body.pin.trim() : undefined;
    const pinHash = pin ? hashPin(pin) : null;

    const profile = await prisma.profile.create({ data: { name, pinHash } });
    invalidateProfileCache();

    return reply.code(201).send({ profile: { id: profile.id, name: profile.name, hasPin: pinHash != null } });
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/profiles/:id/verify",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!UUID_V4_PATTERN.test(request.params.id)) {
        return reply.code(400).send({ error: "id must be a valid UUID" });
      }

      const profile = await prisma.profile.findUnique({ where: { id: request.params.id } });
      if (!profile) return reply.code(404).send({ error: "Profile not found" });

      if (!profile.pinHash) {
        return reply
          .code(200)
          .send({ id: profile.id, name: profile.name, profileToken: mintProfileToken(profile.id) });
      }

      const lockout = await getPinLockout(profile.id);
      if (lockout.locked) {
        return reply
          .code(429)
          .send({ error: "Too many incorrect attempts. Try again later.", retryAfterSec: lockout.retryAfterSec });
      }

      const body = (request.body ?? {}) as { pin?: unknown };
      const pin = typeof body.pin === "string" ? body.pin.trim() : "";
      if (!pin || !pinMatches(pin, profile.pinHash)) {
        await recordPinFailure(profile.id);
        return reply.code(401).send({ error: "Incorrect PIN" });
      }

      await clearPinAttempts(profile.id);
      return reply
        .code(200)
        .send({ id: profile.id, name: profile.name, profileToken: mintProfileToken(profile.id) });
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>("/profiles/:id", async (request, reply) => {
    if (!UUID_V4_PATTERN.test(request.params.id)) {
      return reply.code(400).send({ error: "id must be a valid UUID" });
    }

    const profile = await prisma.profile.findUnique({ where: { id: request.params.id } });
    if (!profile) return reply.code(404).send({ error: "Profile not found" });

    const body = (request.body ?? {}) as { name?: unknown; pin?: unknown; currentPin?: unknown };
    const data: { name?: string; pinHash?: string | null } = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return reply.code(400).send({ error: "name must be a non-empty string when provided" });
      }
      data.name = body.name.trim();
    }

    // pin: omitted = leave as-is, null = remove PIN protection, string = set/change PIN.
    if (body.pin !== undefined) {
      if (body.pin === null) {
        data.pinHash = null;
      } else if (typeof body.pin === "string" && body.pin.trim()) {
        data.pinHash = hashPin(body.pin.trim());
      } else {
        return reply.code(400).send({ error: "pin must be a non-empty string or null when provided" });
      }

      // Changing or removing an *existing* PIN requires proving you know it —
      // otherwise PIN protection is meaningless from Settings (anyone with app
      // access could strip it without ever seeing the PIN). Setting a PIN for
      // the first time needs no proof, since there's nothing to bypass yet.
      if (profile.pinHash) {
        const lockout = await getPinLockout(profile.id);
        if (lockout.locked) {
          return reply
            .code(429)
            .send({ error: "Too many incorrect attempts. Try again later.", retryAfterSec: lockout.retryAfterSec });
        }

        const currentPin = typeof body.currentPin === "string" ? body.currentPin.trim() : "";
        if (!currentPin || !pinMatches(currentPin, profile.pinHash)) {
          await recordPinFailure(profile.id);
          return reply.code(401).send({ error: "Incorrect current PIN" });
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "name or pin must be provided" });
    }

    const updated = await prisma.profile.update({ where: { id: profile.id }, data });
    invalidateProfileCache();

    // The PIN just changed (or was removed) — any outstanding lockout/attempt
    // count from the old PIN no longer applies.
    if (data.pinHash !== undefined) {
      await clearPinAttempts(profile.id);
    }

    return { profile: { id: updated.id, name: updated.name, hasPin: updated.pinHash != null } };
  });

  app.delete<{ Params: { id: string } }>("/profiles/:id", async (request, reply) => {
    if (!UUID_V4_PATTERN.test(request.params.id)) {
      return reply.code(400).send({ error: "id must be a valid UUID" });
    }

    const profile = await prisma.profile.findUnique({ where: { id: request.params.id } });
    if (!profile) return reply.code(404).send({ error: "Profile not found" });

    const profileCount = await prisma.profile.count();
    if (profileCount === 1) {
      return reply.code(400).send({ error: "Cannot delete the last profile" });
    }

    await prisma.profile.delete({ where: { id: profile.id } });
    invalidateProfileCache();

    // Clean up any PIN attempt records for the deleted profile
    await clearPinAttempts(profile.id);

    return reply.code(204).send();
  });
};

export default profilesRoutes;
