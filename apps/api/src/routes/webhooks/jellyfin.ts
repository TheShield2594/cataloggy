import type { FastifyPluginAsync } from "fastify";
import { recordWatchEvent } from "../../lib/watch-event.js";
import { verifyWebhookSecret } from "../../lib/webhook-auth.js";
import { resolveWebhookProfile } from "../../lib/webhook-profile.js";

const jellyfinWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/webhooks/jellyfin", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
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
      // The webhook plugin's playback templates expose the viewer under
      // NotificationUsername; older/custom templates send plain Username.
      NotificationUsername?: string;
      Username?: string;
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

    // `??` alone would stop at a NotificationUsername the webhook template
    // rendered as an empty string, never reaching the Username fallback.
    const accountName = body.NotificationUsername?.trim() || body.Username;
    const profile = await resolveWebhookProfile(request, accountName);
    if (!profile.ok) {
      return reply.code(profile.status).send({ error: profile.error });
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
        profileId: profile.profileId,
        log: request.log,
      });
      return reply.code(201).send(result);
    }

    const result = await recordWatchEvent({
      type: "movie",
      imdbId,
      watchedAt: now,
      source: "Jellyfin",
      profileId: profile.profileId,
      log: request.log,
    });
    return reply.code(201).send(result);
  });
};

export default jellyfinWebhookRoutes;
