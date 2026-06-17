import type { FastifyPluginAsync } from "fastify";
import { recordWatchEvent } from "../../lib/watch-event.js";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET?.trim();

const verifyWebhookSecret = (request: import("fastify").FastifyRequest): boolean => {
  if (!WEBHOOK_SECRET) return false;
  const provided =
    (request.query as Record<string, string>).token ??
    (request.headers["x-webhook-secret"] as string | undefined);
  return provided === WEBHOOK_SECRET;
};

const jellyfinWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/webhooks/jellyfin", async (request, reply) => {
    if (!verifyWebhookSecret(request)) {
      return reply.code(403).send({ error: "Invalid webhook secret" });
    }

    const body = request.body as {
      NotificationType?: string;
      ItemType?: string;
      Name?: string;
      SeriesName?: string;
      Season?: number;
      Episode?: number;
      Provider_imdb?: string;
      SeriesId?: string;
    } | null;

    if (!body) {
      return reply.code(400).send({ error: "Empty body" });
    }

    if (body.NotificationType !== "PlaybackStop") {
      request.log.info({ type: body.NotificationType }, "Jellyfin webhook ignored");
      return reply.code(200).send({ status: "ignored", type: body.NotificationType });
    }

    const imdbId = body.Provider_imdb?.trim();
    if (!imdbId) {
      request.log.warn({ body }, "Jellyfin webhook: no IMDb ID");
      return reply.code(200).send({ status: "skipped", reason: "no_imdb_id" });
    }

    const now = new Date();

    if (body.ItemType === "Episode") {
      const season = typeof body.Season === "number" ? body.Season : null;
      const episode = typeof body.Episode === "number" ? body.Episode : null;
      const result = await recordWatchEvent({
        type: "episode",
        imdbId,
        seriesImdbId: imdbId,
        season,
        episode,
        watchedAt: now,
        source: "Jellyfin",
        request,
      });
      return reply.code(201).send(result);
    }

    const result = await recordWatchEvent({
      type: "movie",
      imdbId,
      watchedAt: now,
      source: "Jellyfin",
      request,
    });
    return reply.code(201).send(result);
  });
};

export default jellyfinWebhookRoutes;
