import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { mintProfileToken } from "../lib/profile-token.js";
import { hasValidProfileToken, invalidateProfileCache, isActingAsProfile } from "../lib/profile.js";
import { hashPin, isValidPinFormat, needsRehash, pinLengthError, pinMatches } from "../lib/pin-hash.js";
import { UUID_V4_PATTERN } from "../lib/types.js";

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 5 * 60 * 1000;
/** Ceiling on the doubling below — an hour, not a permanent lockout. */
const MAX_PIN_LOCKOUT_MS = 60 * 60 * 1000;
/**
 * Quiet period after which the escalation resets. Without it a household that
 * fat-fingers a PIN twice a year would eventually be starting from the long
 * end of the backoff; with it, only sustained guessing keeps the multiplier up.
 */
const LOCKOUT_DECAY_MS = 24 * 60 * 60 * 1000;

const pinAttemptKey = (profileId: string) => `pinattempts:${profileId}`;

type PinAttemptData = { count: number; lockedUntil: string; lockouts?: number };

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
    let data: PinAttemptData = { count: 0, lockedUntil: "", lockouts: 0 };

    if (row) {
      try {
        const parsed = JSON.parse(row.value) as PinAttemptData;
        data = {
          count: Number.isInteger(parsed.count) ? parsed.count : 0,
          lockedUntil: typeof parsed.lockedUntil === "string" ? parsed.lockedUntil : "",
          lockouts: Number.isInteger(parsed.lockouts) ? (parsed.lockouts as number) : 0,
        };
      } catch { /* unreadable value — start the record over */ }

      // A quiet day wipes the slate, escalation tier included; otherwise an
      // expired lockout restarts the attempt count but keeps the tier, so a
      // griefer can't reset the backoff by waiting each lockout out.
      const sinceLastFailure = now.getTime() - row.updatedAt.getTime();
      if (sinceLastFailure > LOCKOUT_DECAY_MS) {
        data = { count: 0, lockedUntil: "", lockouts: 0 };
      } else if (data.lockedUntil && new Date(data.lockedUntil).getTime() <= Date.now()) {
        data = { count: 0, lockedUntil: "", lockouts: data.lockouts };
      }
    }

    data.count += 1;
    if (data.count >= MAX_PIN_ATTEMPTS) {
      // Each successive lockout lasts twice as long, up to an hour. A flat
      // 5 minutes let anyone holding the shared API_TOKEN re-lock a profile
      // every five minutes forever for the cost of five wrong guesses;
      // doubling makes sustaining that cost the griefer real time, while the
      // first mistake still only costs the owner five minutes. Verifying the
      // PIN clears the record entirely.
      const lockouts = (data.lockouts ?? 0) + 1;
      const lockoutMs = Math.min(PIN_LOCKOUT_MS * 2 ** (lockouts - 1), MAX_PIN_LOCKOUT_MS);
      data.lockedUntil = new Date(Date.now() + lockoutMs).toISOString();
      data.count = 0;
      data.lockouts = lockouts;
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

/**
 * Re-hashes a PIN that just verified against a pre-scrypt (unsalted SHA-256)
 * hash, so existing PINs move to the salted KDF the first time they're used
 * instead of every household having to set theirs again. Best-effort: a failed
 * write must not turn a correct PIN into a rejected one.
 */
const upgradePinHashIfNeeded = async (
  app: FastifyInstance,
  profileId: string,
  pin: string,
  pinHash: string
): Promise<void> => {
  if (!needsRehash(pinHash)) return;
  try {
    await prisma.profile.update({ where: { id: profileId }, data: { pinHash: await hashPin(pin) } });
    invalidateProfileCache();
  } catch (error) {
    app.log.warn({ err: error, profileId }, "Failed to upgrade a legacy PIN hash");
  }
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
    if (pin !== undefined && !isValidPinFormat(pin)) {
      return reply.code(400).send({ error: pinLengthError });
    }
    const pinHash = pin ? await hashPin(pin) : null;

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
      if (!pin || !(await pinMatches(pin, profile.pinHash))) {
        await recordPinFailure(profile.id);
        return reply.code(401).send({ error: "Incorrect PIN" });
      }

      await upgradePinHashIfNeeded(app, profile.id, pin, profile.pinHash);
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
      let nextPin: string | null = null;
      if (body.pin === null) {
        data.pinHash = null;
      } else if (typeof body.pin === "string" && body.pin.trim()) {
        nextPin = body.pin.trim();
        if (!isValidPinFormat(nextPin)) {
          return reply.code(400).send({ error: pinLengthError });
        }
      } else {
        return reply.code(400).send({ error: "pin must be a non-empty string or null when provided" });
      }

      // Changing or removing an *existing* PIN requires proving you know it —
      // otherwise PIN protection is meaningless from Settings (anyone with app
      // access could strip it without ever seeing the PIN). Setting a PIN for
      // the first time needs no proof, since there's nothing to bypass yet —
      // but then it has to be *your* profile: a first PIN set on someone else's
      // locks them out of it, and removing it needs the PIN they never chose.
      if (!profile.pinHash && nextPin && !(await isActingAsProfile(request, profile.id))) {
        return reply.code(403).send({
          error: "Switch to this profile to set its PIN",
          code: "profile_not_active",
        });
      }

      if (profile.pinHash) {
        const lockout = await getPinLockout(profile.id);
        if (lockout.locked) {
          return reply
            .code(429)
            .send({ error: "Too many incorrect attempts. Try again later.", retryAfterSec: lockout.retryAfterSec });
        }

        const currentPin = typeof body.currentPin === "string" ? body.currentPin.trim() : "";
        if (!currentPin || !(await pinMatches(currentPin, profile.pinHash))) {
          await recordPinFailure(profile.id);
          return reply.code(401).send({ error: "Incorrect current PIN" });
        }
      }

      // Derived only once the caller has proved the current PIN — scrypt is
      // deliberately expensive, and a rejected request shouldn't buy any of it.
      if (nextPin) data.pinHash = await hashPin(nextPin);
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

  app.delete<{ Params: { id: string }; Body: unknown }>("/profiles/:id", async (request, reply) => {
    if (!UUID_V4_PATTERN.test(request.params.id)) {
      return reply.code(400).send({ error: "id must be a valid UUID" });
    }

    const profile = await prisma.profile.findUnique({ where: { id: request.params.id } });
    if (!profile) return reply.code(404).send({ error: "Profile not found" });

    const profileCount = await prisma.profile.count();
    if (profileCount === 1) {
      return reply.code(400).send({ error: "Cannot delete the last profile" });
    }

    // Deleting a locked profile destroys everything it owns — every child model
    // cascades — so it needs at least the proof-of-PIN that changing that PIN
    // requires. Otherwise the household member the PIN is meant to keep out
    // could still wipe the profile, PIN and all, with the shared API token.
    //
    // An `x-profile-token` minted for *this* profile already proves the caller
    // cleared the PIN gate, so deleting the profile you are currently in does
    // not re-prompt; deleting someone else's locked profile needs its PIN.
    if (profile.pinHash && !hasValidProfileToken(request, profile.id)) {
      const lockout = await getPinLockout(profile.id);
      if (lockout.locked) {
        return reply
          .code(429)
          .send({ error: "Too many incorrect attempts. Try again later.", retryAfterSec: lockout.retryAfterSec });
      }

      const body = (request.body ?? {}) as { currentPin?: unknown };
      const currentPin = typeof body.currentPin === "string" ? body.currentPin.trim() : "";
      if (!currentPin || !(await pinMatches(currentPin, profile.pinHash))) {
        await recordPinFailure(profile.id);
        return reply.code(401).send({ error: "Incorrect current PIN" });
      }
    }

    await prisma.profile.delete({ where: { id: profile.id } });
    invalidateProfileCache();

    // Clean up any PIN attempt records for the deleted profile
    await clearPinAttempts(profile.id);

    return reply.code(204).send();
  });
};

export default profilesRoutes;
