import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { type CachedProfile, profileCache, profileCacheClear, profileLookups } from "./cache.js";
import { verifyProfileToken } from "./profile-token.js";
import { UUID_V4_PATTERN } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    profileId?: string;
  }
}

/** Exported for the one route that reads it without going through `resolveProfile`. */
export const PROFILE_HEADER = "x-profile-id";
const PROFILE_TOKEN_HEADER = "x-profile-token";

/**
 * Resolves the active profile for a request from the `x-profile-id` header.
 *
 * If the header is absent and there is exactly one profile in the system,
 * that profile is used automatically — this keeps a brand-new single-profile
 * install working with zero frontend changes. Otherwise, when multiple
 * profiles exist, the header is required.
 */
// Used by surfaces that have no concept of multiple profiles (the Stremio
// addon protocol, scheduled background jobs) to pick a sensible default —
// the oldest profile, which is the seeded "Default" profile on existing
// single-tenant installs.
export const getDefaultProfileId = async (): Promise<string> => {
  const profile = await prisma.profile.findFirst({ orderBy: { createdAt: "asc" } });
  if (profile) return profile.id;

  const created = await prisma.profile.create({ data: { name: "Default" } });
  invalidateProfileCache();
  return created.id;
};

// Called by every route that creates, updates or deletes a profile — the cache
// below is a burst collapser, not a source of truth, so it is thrown away
// wholesale rather than surgically patched.
export const invalidateProfileCache = profileCacheClear;

// The "no x-profile-id header" probe is cached under its own key; the payload is
// the same shape as a by-ID hit so both paths share one cache. Every other key
// is a profile UUID, which cannot contain a colon, so the two spaces cannot
// collide. (It was a NUL-prefixed string, which made git treat this whole file
// as binary and print no diff for it.)
const PROFILE_PROBE_KEY = "probe:no-profile-header";

// Read-through with single-flight: a cache hit returns immediately, a miss with a
// lookup already in flight joins that lookup, and only the first caller of a cold
// key actually queries. `load` results are cached only when non-empty, so a miss
// (unknown profile ID) stays uncached — that is a 404 path, not a hot one.
const readThrough = async (
  key: string,
  load: () => Promise<CachedProfile[]>
): Promise<CachedProfile[]> => {
  const cached = profileCache.get(key);
  if (cached) return cached;

  const inFlight = profileLookups.get(key);
  if (inFlight) return inFlight;

  const lookup = load()
    .then((profiles) => {
      if (profiles.length > 0) profileCache.set(key, profiles);
      return profiles;
    })
    .finally(() => {
      profileLookups.delete(key);
    });

  profileLookups.set(key, lookup);
  return lookup;
};

const findProfileById = async (id: string): Promise<CachedProfile | null> => {
  const profiles = await readThrough(id, async () => {
    const profile = await prisma.profile.findUnique({
      where: { id },
      select: { id: true, pinHash: true },
    });
    return profile ? [profile] : [];
  });
  return profiles[0] ?? null;
};

const findProfileCandidates = async (): Promise<CachedProfile[]> =>
  readThrough(PROFILE_PROBE_KEY, () =>
    prisma.profile.findMany({ select: { id: true, pinHash: true }, take: 2 })
  );

// A PIN-protected profile requires a valid, unexpired profile-access token
// (minted by POST /profiles/:id/verify on correct PIN). This is what makes the
// PIN a real server-side boundary rather than a client-side prompt: a token
// holder can't reach a locked profile's data just by naming its UUID.
export const hasValidProfileToken = (request: FastifyRequest, profileId: string): boolean => {
  const headerValue = request.headers[PROFILE_TOKEN_HEADER];
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return verifyProfileToken(token, profileId);
};

export const PROFILE_LOCKED_RESPONSE = {
  error: "Profile PIN verification required",
  code: "profile_verification_required",
} as const;

/**
 * Whether `profileId` is PIN-protected and this request hasn't verified it.
 *
 * `resolveProfile` applies this to the `x-profile-id` header path. Surfaces that
 * choose a profile some other way have to apply it themselves — the Stremio
 * routes select one from a `?profileId=` query parameter, and fall back to the
 * default profile when it is absent. Neither goes through `resolveProfile`, so
 * without this the PIN stopped being a boundary the moment a caller stopped
 * using the header.
 */
export const isProfileLocked = async (
  request: FastifyRequest,
  profileId: string
): Promise<boolean> => {
  const profile = await findProfileById(profileId);
  return Boolean(profile?.pinHash) && !hasValidProfileToken(request, profileId);
};

/**
 * Whether the request is acting *as* `profileId` — the same selection
 * `resolveProfile` makes, without the PIN gate or the replies.
 *
 * Used where a route may act on any profile but one particular change is only
 * yours to make: setting a first PIN takes no proof (there is nothing yet to
 * prove), so without this any holder of the shared token could PIN-lock a
 * household member out of their own profile, and removing it would then need
 * the PIN they never chose.
 */
export const isActingAsProfile = async (
  request: FastifyRequest,
  profileId: string
): Promise<boolean> => {
  const headerValue = request.headers[PROFILE_HEADER];
  const rawProfileId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (rawProfileId) return rawProfileId === profileId;

  // No header is the single-profile install, where the one profile is implied.
  const profiles = await findProfileCandidates();
  const [only, ...rest] = profiles;
  return rest.length === 0 && only?.id === profileId;
};

export const resolveProfile = async (request: FastifyRequest, reply: FastifyReply) => {
  const headerValue = request.headers[PROFILE_HEADER];
  const rawProfileId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (rawProfileId) {
    if (!UUID_V4_PATTERN.test(rawProfileId)) {
      return reply.code(400).send({ error: "x-profile-id must be a valid UUID" });
    }
    const profile = await findProfileById(rawProfileId);
    if (!profile) {
      return reply.code(404).send({ error: "Profile not found" });
    }
    if (profile.pinHash && !hasValidProfileToken(request, profile.id)) {
      return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
    }
    request.profileId = rawProfileId;
    return;
  }

  const profiles = await findProfileCandidates();
  const [only, ...rest] = profiles;
  if (only && rest.length === 0) {
    if (only.pinHash && !hasValidProfileToken(request, only.id)) {
      return reply.code(401).send(PROFILE_LOCKED_RESPONSE);
    }
    request.profileId = only.id;
    return;
  }

  return reply.code(400).send({ error: "x-profile-id header is required" });
};
