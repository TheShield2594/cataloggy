import type { FastifyReply, FastifyRequest } from "fastify";

const IS_DEVELOPMENT = process.env.NODE_ENV === "development";
const PRODUCTION_UI_ORIGIN = "https://cataloggy.domain.com";
const CATALOGGY_ALLOWED_ORIGINS = (process.env.CATALOGGY_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
export const ALLOWED_ORIGINS = IS_DEVELOPMENT
  ? ["*"]
  : Array.from(new Set([PRODUCTION_UI_ORIGIN, ...CATALOGGY_ALLOWED_ORIGINS]));

const CORS_METHODS = "GET,POST,DELETE,PATCH,OPTIONS";
const CORS_HEADERS = "Authorization,Content-Type,X-Profile-Id";

export const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (IS_DEVELOPMENT) return true;
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
};

export const applyCorsHeaders = (request: FastifyRequest, reply: FastifyReply) => {
  const origin = request.headers.origin;

  if (IS_DEVELOPMENT) {
    reply.header("Access-Control-Allow-Origin", origin ?? "*");
    reply.header("Access-Control-Allow-Methods", CORS_METHODS);
    reply.header("Access-Control-Allow-Headers", CORS_HEADERS);
    return;
  }

  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return;

  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Access-Control-Allow-Methods", CORS_METHODS);
  reply.header("Access-Control-Allow-Headers", CORS_HEADERS);
  reply.header("Vary", "Origin");
};
