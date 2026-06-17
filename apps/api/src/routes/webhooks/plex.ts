import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { recordWatchEvent } from "../../lib/watch-event.js";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET?.trim();

const verifyWebhookSecret = (request: import("fastify").FastifyRequest): boolean => {
  if (!WEBHOOK_SECRET) return false;
  const provided =
    (request.query as Record<string, string>).token ??
    (request.headers["x-webhook-secret"] as string | undefined);
  if (!provided || provided.length !== WEBHOOK_SECRET.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(WEBHOOK_SECRET));
};

function extractMultipartPayload(rawBody: string, contentType: string): string | null {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) return null;

  const parts = rawBody.split(`--${boundary}`);
  for (const part of parts) {
    if (!/name="payload"/i.test(part)) continue;

    const headerEnd = part.indexOf("\r\n\r\n");
    const altHeaderEnd = part.indexOf("\n\n");
    const bodyStart =
      headerEnd !== -1 ? headerEnd + 4 : altHeaderEnd !== -1 ? altHeaderEnd + 2 : -1;
    if (bodyStart === -1) continue;

    const body = part.slice(bodyStart).trim();
    if (body.startsWith("{") && body.endsWith("}")) return body;
  }
  return null;
}

const plexWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser(
    "multipart/form-data",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    }
  );

  app.post("/webhooks/plex", async (request, reply) => {
    if (!verifyWebhookSecret(request)) {
      return reply.code(403).send({ error: "Invalid webhook secret" });
    }

    let payloadStr: string | null = null;
    const rawBody = request.body;

    if (typeof rawBody === "string") {
      payloadStr = extractMultipartPayload(rawBody, request.headers["content-type"] ?? "");
    } else if (rawBody && typeof rawBody === "object") {
      payloadStr = JSON.stringify(rawBody);
    }

    if (!payloadStr) {
      return reply.code(400).send({
        error: "No payload found. Expected multipart/form-data with a 'payload' field.",
      });
    }

    let payload: {
      event?: string;
      Metadata?: {
        type?: string;
        title?: string;
        grandparentTitle?: string;
        parentIndex?: number;
        index?: number;
        Guid?: Array<{ id?: string }>;
        guid?: string;
      };
    };

    try {
      payload = JSON.parse(payloadStr);
    } catch {
      return reply.code(400).send({ error: "Invalid JSON payload" });
    }

    const event = payload.event;
    if (event !== "media.scrobble") {
      request.log.info({ event }, "Plex webhook ignored (not a scrobble event)");
      return reply.code(200).send({ status: "ignored", event });
    }

    const metadata = payload.Metadata;
    if (!metadata) {
      return reply.code(400).send({ error: "No Metadata in payload" });
    }

    let imdbId: string | null = null;
    for (const guid of metadata.Guid ?? []) {
      const match = guid.id?.match(/imdb:\/\/(tt\d+)/);
      if (match) {
        imdbId = match[1];
        break;
      }
    }
    if (!imdbId && metadata.guid) {
      const match = metadata.guid.match(/imdb:\/\/(tt\d+)/);
      if (match) imdbId = match[1];
    }

    if (!imdbId) {
      request.log.warn({ metadata }, "Plex webhook: no IMDb ID found");
      return reply.code(200).send({ status: "skipped", reason: "no_imdb_id" });
    }

    const now = new Date();

    if (metadata.type === "episode") {
      const season = metadata.parentIndex ?? null;
      const episode = metadata.index ?? null;
      const result = await recordWatchEvent({
        type: "episode",
        imdbId,
        seriesImdbId: imdbId,
        season,
        episode,
        watchedAt: now,
        source: "Plex",
        request,
      });
      return reply.code(201).send(result);
    }

    const result = await recordWatchEvent({
      type: "movie",
      imdbId,
      watchedAt: now,
      source: "Plex",
      request,
    });
    return reply.code(201).send(result);
  });
};

export default plexWebhookRoutes;
