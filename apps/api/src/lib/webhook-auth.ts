import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET?.trim();

const WEBHOOK_ALLOWED_IPS = (process.env.WEBHOOK_ALLOWED_IPS ?? "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);

// Strips the IPv4-mapped IPv6 prefix (e.g. "::ffff:192.168.1.5") so plain
// IPv4 addresses in WEBHOOK_ALLOWED_IPS match requests proxied through it.
const normalizeIp = (ip: string): string => ip.replace(/^::ffff:/, "");

export const isAllowedWebhookIp = (request: FastifyRequest): boolean => {
  if (WEBHOOK_ALLOWED_IPS.length === 0) return true;
  return WEBHOOK_ALLOWED_IPS.includes(normalizeIp(request.ip));
};

export const verifyWebhookSecret = (request: FastifyRequest): boolean => {
  if (!WEBHOOK_SECRET) return false;
  if (!isAllowedWebhookIp(request)) return false;
  const provided =
    (request.query as Record<string, string>).token ??
    (request.headers["x-webhook-secret"] as string | undefined);
  if (!provided || provided.length !== WEBHOOK_SECRET.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(WEBHOOK_SECRET));
};
