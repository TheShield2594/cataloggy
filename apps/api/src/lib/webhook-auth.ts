import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET?.trim();

export const verifyWebhookSecret = (request: FastifyRequest): boolean => {
  if (!WEBHOOK_SECRET) return false;
  const provided =
    (request.query as Record<string, string>).token ??
    (request.headers["x-webhook-secret"] as string | undefined);
  if (!provided || provided.length !== WEBHOOK_SECRET.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(WEBHOOK_SECRET));
};
