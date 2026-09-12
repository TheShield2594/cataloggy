import type { FastifyPluginAsync } from "fastify";
import { recordWatchEvent } from "../../lib/watch-event.js";
import { verifyWebhookSecret } from "../../lib/webhook-auth.js";
import { resolveWebhookProfile } from "../../lib/webhook-profile.js";

/**
 * Emby posts the item as the server holds it — `Item.ProviderIds` is the same
 * dictionary the metadata scraper filled in — rather than Jellyfin's flattened
 * `Provider_imdb`, so the ids arrive nested and keyed however the scraper spelt
 * them (`Imdb`, `IMDB`, `imdb` have all been seen). Read case-insensitively.
 */
type EmbyProviderIds = Record<string, unknown>;

type EmbyItem = {
  Type?: string;
  Name?: string;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ProviderIds?: EmbyProviderIds;
  /** Present on episodes in the builds that send it; see `seriesImdbIdOf`. */
  SeriesProviderIds?: EmbyProviderIds;
};

type EmbyPayload = {
  Event?: string;
  Item?: EmbyItem;
  User?: { Name?: string };
  /** Emby's JSON templating lets a payload be reshaped; accept the flat spelling too. */
  Username?: string;
} | null;

/**
 * Emby's own events are dotted and lowercase (`playback.stop`), but its payload
 * template can be edited, and the templates people copy between the two servers
 * carry Jellyfin's spelling (`PlaybackStop`). Comparing on letters alone accepts
 * both rather than answering a reshaped payload with a silent "ignored".
 */
const normalizeName = (value: string | undefined): string =>
  (value ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Only a finished play is a watch. Emby also fires `playback.start`,
 * `.pause`, `.unpause`, `item.markplayed` and the library events; the last of
 * those would be a watch too, but a manual mark-played that follows a play the
 * same day lands in the same dedup window and would count the play twice — so
 * the stop event, which is what Plex and Jellyfin are wired to here, is the one
 * signal taken.
 */
const PLAYBACK_STOP = "playbackstop";

const IMDB_ID_PATTERN = /^tt\d{7,}$/;

const imdbIdOf = (ids: EmbyProviderIds | undefined): string | null => {
  for (const [key, value] of Object.entries(ids ?? {})) {
    if (key.toLowerCase() !== "imdb") continue;
    const id = typeof value === "string" ? value.trim() : "";
    if (IMDB_ID_PATTERN.test(id)) return id;
  }
  return null;
};

/**
 * Cataloggy keys a series by its IMDb id, so an episode has to arrive with one.
 *
 * `SeriesProviderIds` is the right answer and the one to prefer, but Emby only
 * sends it on some builds and only when the series was scraped from a source
 * that has an IMDb id. The fallback is the episode's own ids — which is what
 * the Jellyfin route does with `Provider_imdb`, and is right whenever the
 * scraper filled the episode in from the series entry. An episode carrying only
 * its own distinct IMDb id would record under that id; there is nothing in the
 * payload that distinguishes the two cases, and skipping outright would drop
 * every Emby episode on the builds that send no series ids at all.
 */
const seriesImdbIdOf = (item: EmbyItem): string | null =>
  imdbIdOf(item.SeriesProviderIds) ?? imdbIdOf(item.ProviderIds);

const embyWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/webhooks/emby", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!verifyWebhookSecret(request)) {
      return reply.code(403).send({ error: "Invalid webhook secret" });
    }

    const body = request.body as EmbyPayload;
    if (!body) {
      return reply.code(400).send({ error: "Empty body" });
    }

    if (normalizeName(body.Event) !== PLAYBACK_STOP) {
      request.log.info({ event: body.Event }, "Emby webhook ignored (not a playback stop)");
      return reply.code(200).send({ status: "ignored", event: body.Event ?? null });
    }

    const item = body.Item;
    if (!item) {
      return reply.code(400).send({ error: "No Item in payload" });
    }

    // Emby webhooks fire for every library type it plays, music and home videos
    // included. Jellyfin's route treats everything that is not an episode as a
    // film; here the two kinds Cataloggy stores are named, and the rest are
    // turned away with a reason rather than filed as films.
    const itemType = normalizeName(item.Type);
    if (itemType !== "episode" && itemType !== "movie") {
      request.log.info({ itemType: item.Type }, "Emby webhook skipped (unsupported item type)");
      return reply.code(200).send({ status: "skipped", reason: "unsupported_item_type" });
    }

    const imdbId = itemType === "episode" ? seriesImdbIdOf(item) : imdbIdOf(item.ProviderIds);
    if (!imdbId) {
      // The ids that *were* present are the diagnosis: an item Emby only holds a
      // Tvdb id for is a scraper setting, not a Cataloggy fault, and the log line
      // is where that gets seen.
      request.log.warn(
        { providerIds: item.ProviderIds, seriesProviderIds: item.SeriesProviderIds, name: item.Name },
        "Emby webhook: no IMDb ID"
      );
      return reply.code(200).send({ status: "skipped", reason: "no_imdb_id" });
    }

    // Same shape as the Jellyfin route's username handling: `??` alone would
    // stop at a `User.Name` a reshaped template rendered as an empty string.
    const accountName = body.User?.Name?.trim() || body.Username;
    const profile = await resolveWebhookProfile(request, accountName);
    if (!profile.ok) {
      return reply.code(profile.status).send({ error: profile.error });
    }

    const now = new Date();

    if (itemType === "episode") {
      const result = await recordWatchEvent({
        type: "episode",
        imdbId,
        seriesImdbId: imdbId,
        season: typeof item.ParentIndexNumber === "number" ? item.ParentIndexNumber : null,
        episode: typeof item.IndexNumber === "number" ? item.IndexNumber : null,
        watchedAt: now,
        source: "Emby",
        profileId: profile.profileId,
        log: request.log,
      });
      return reply.code(201).send(result);
    }

    const result = await recordWatchEvent({
      type: "movie",
      imdbId,
      watchedAt: now,
      source: "Emby",
      profileId: profile.profileId,
      log: request.log,
    });
    return reply.code(201).send(result);
  });
};

export default embyWebhookRoutes;
