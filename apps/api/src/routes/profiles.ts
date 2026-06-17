import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
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

const pinAttempts = new Map<string, { count: number; lockedUntil: number }>();

const getPinLockout = (profileId: string): { locked: boolean; retryAfterSec: number } => {
  const entry = pinAttempts.get(profileId);
  if (!entry || entry.lockedUntil <= Date.now()) return { locked: false, retryAfterSec: 0 };
  return { locked: true, retryAfterSec: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
};

const recordPinFailure = (profileId: string): void => {
  const entry = pinAttempts.get(profileId) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_PIN_ATTEMPTS) {
    entry.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
    entry.count = 0;
  }
  pinAttempts.set(profileId, entry);
};

const clearPinAttempts = (profileId: string): void => {
  pinAttempts.delete(profileId);
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

    return reply.code(201).send({ profile: { id: profile.id, name: profile.name, hasPin: pinHash != null } });
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/profiles/:id/verify", async (request, reply) => {
    if (!UUID_V4_PATTERN.test(request.params.id)) {
      return reply.code(400).send({ error: "id must be a valid UUID" });
    }

    const profile = await prisma.profile.findUnique({ where: { id: request.params.id } });
    if (!profile) return reply.code(404).send({ error: "Profile not found" });

    if (!profile.pinHash) {
      return reply.code(200).send({ id: profile.id, name: profile.name });
    }

    const lockout = getPinLockout(profile.id);
    if (lockout.locked) {
      return reply
        .code(429)
        .send({ error: "Too many incorrect attempts. Try again later.", retryAfterSec: lockout.retryAfterSec });
    }

    const body = (request.body ?? {}) as { pin?: unknown };
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    if (!pin || !pinMatches(pin, profile.pinHash)) {
      recordPinFailure(profile.id);
      return reply.code(401).send({ error: "Incorrect PIN" });
    }

    clearPinAttempts(profile.id);
    return reply.code(200).send({ id: profile.id, name: profile.name });
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

    return reply.code(204).send();
  });
};

export default profilesRoutes;
