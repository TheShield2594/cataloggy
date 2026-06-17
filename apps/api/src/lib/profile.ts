import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { UUID_V4_PATTERN } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    profileId?: string;
  }
}

const PROFILE_HEADER = "x-profile-id";

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
  return created.id;
};

export const resolveProfile = async (request: FastifyRequest, reply: FastifyReply) => {
  const headerValue = request.headers[PROFILE_HEADER];
  const rawProfileId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (rawProfileId) {
    if (!UUID_V4_PATTERN.test(rawProfileId)) {
      return reply.code(400).send({ error: "x-profile-id must be a valid UUID" });
    }
    request.profileId = rawProfileId;
    return;
  }

  const profiles = await prisma.profile.findMany({ select: { id: true }, take: 2 });
  if (profiles.length === 1) {
    request.profileId = profiles[0].id;
    return;
  }

  return reply.code(400).send({ error: "x-profile-id header is required" });
};
