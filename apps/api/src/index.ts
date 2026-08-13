import { Sentry } from "./lib/sentry.js";
import Fastify, { type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import {
  parseProxyPathPrefixes,
  normalizeProxyPath,
  parseTrustProxy,
  deriveServiceToken,
  matchesServiceToken,
  SERVICE_TOKEN_HEADER,
} from "@cataloggy/shared";
import { prisma } from "./lib/prisma.js";
import { applyCorsHeaders } from "./lib/cors.js";
import { registerHttpCaching } from "./lib/http-cache.js";
import { verifyToken } from "./lib/auth.js";
import { isStremioSecretPath } from "./lib/stremio-secret.js";
import { getAiRecommendations, isAiConfigured } from "./lib/ai.js";
import { trendingCacheDeletePrefix } from "./lib/cache.js";
import { pollTraktHistory, syncTraktWatchlist } from "./lib/trakt-client.js";
import { isStremioConnected, getStremioProfileId, syncStremioLibrary } from "./lib/stremio-library.js";
import { isPlayDetectionEnabled, settleDuePlaySignals } from "./lib/play-signal.js";
import { ensureDefaultWatchlist } from "./lib/watchlist.js";
import { ensureDefaultCollection } from "./lib/collection.js";
import { getDefaultProfileId } from "./lib/profile.js";
import { encryptStoredSecrets } from "./lib/secret-migration.js";
import { checkUpcomingEpisodesAndNotify } from "./lib/notify-episodes.js";
import { isSteamSyncConfigured, syncSteamLibrary } from "./lib/steam-sync.js";
import { cleanupStaleSessions, SCROBBLE_CLEANUP_INTERVAL_MS } from "./routes/scrobble.js";
import { everyInterval, parseIntervalSec } from "./lib/scheduler.js";
import { bodyTooLargeMessage, isBodyTooLargeError, mbToBytes, parseMaxBodySizeMb } from "./lib/body-limit.js";
import { redactUrl, redactedRequestSerializer } from "./lib/redact-url.js";

// Route modules
import healthRoutes from "./routes/health.js";
import profilesRoutes from "./routes/profiles.js";
import searchRoutes from "./routes/search.js";
import metadataRoutes from "./routes/metadata.js";
import watchRoutes from "./routes/watch.js";
import ratingsRoutes from "./routes/ratings.js";
import tagsRoutes from "./routes/tags.js";
import listsRoutes from "./routes/lists.js";
import seriesRoutes from "./routes/series.js";
import calendarRoutes from "./routes/calendar.js";
import streamingRoutes from "./routes/streaming.js";
import settingsRoutes from "./routes/settings.js";
import aiRoutes from "./routes/ai.js";
import stremioRoutes from "./routes/stremio.js";
import stremioLibraryRoutes from "./routes/stremio-library.js";
import traktRoutes from "./routes/trakt.js";
import scrobbleRoutes from "./routes/scrobble.js";
import pushRoutes from "./routes/push.js";
import notificationRoutes from "./routes/notifications.js";
import exportRoutes from "./routes/export.js";
import importRoutes from "./routes/import.js";
import plexWebhookRoutes from "./routes/webhooks/plex.js";
import jellyfinWebhookRoutes from "./routes/webhooks/jellyfin.js";
import gamesRoutes from "./routes/games.js";
import gamesSteamRoutes from "./routes/games-steam.js";

// Every interval goes through the same validator: reading one as `Number(raw ??
// fallback)` turns a typo into NaN, and `NaN > 0` is false, so a mistyped value
// used to disable its job silently while the startup log said it had been "set
// to 0".
const TRAKT_POLL_INTERVAL_SEC = parseIntervalSec("TRAKT_POLL_INTERVAL_SEC", process.env.TRAKT_POLL_INTERVAL_SEC, 300);

// Shorter than the Trakt poll because it costs far less: when nothing has been
// watched, a sync is a single small `datastoreMeta` call that fetches no items
// at all. The interval also bounds the one real gap in this sync — Stremio
// reports the episode you are *on*, so episodes finished within a single
// interval collapse into the latest one. Two minutes is well under any real
// episode length.
// Off by default: with play detection covering every addon-consuming client,
// the library poll is for people who want Stremio's own exact watched state
// rather than an inference. The one-time import stays available either way.
const STREMIO_POLL_INTERVAL_SEC = parseIntervalSec(
  "STREMIO_POLL_INTERVAL_SEC",
  process.env.STREMIO_POLL_INTERVAL_SEC,
  0
);

const PLAY_SIGNAL_SETTLE_INTERVAL_MS = 60 * 1000;
const AI_REFRESH_INTERVAL_SEC = parseIntervalSec("AI_REFRESH_INTERVAL_SEC", process.env.AI_REFRESH_INTERVAL_SEC, 86400);
const NOTIFICATION_CHECK_INTERVAL_SEC = parseIntervalSec(
  "NOTIFICATION_CHECK_INTERVAL_SEC",
  process.env.NOTIFICATION_CHECK_INTERVAL_SEC,
  3600
);
const STEAM_SYNC_INTERVAL_SEC = parseIntervalSec("STEAM_SYNC_INTERVAL_SEC", process.env.STEAM_SYNC_INTERVAL_SEC, 86400);

// The two jobs that would otherwise hammer a cold start wait this long before
// their first run, then settle onto their interval.
const DEFERRED_FIRST_RUN_MS = 2 * 60 * 1000;

const PROXY_PATH_PREFIXES = parseProxyPathPrefixes(process.env.PROXY_PATH_PREFIXES, ["/api"] as const);

const MAX_BODY_SIZE_MB = parseMaxBodySizeMb(process.env.MAX_BODY_SIZE_MB);

const app = Fastify({
  logger: {
    // Fastify's default `req` serializer logs the URL verbatim, so a secret sent
    // as a query parameter — `?token=` on the Plex/Jellyfin webhooks, which Plex
    // has no other way to send — is written to the log in plaintext and kept for
    // as long as the log is. This mirrors that serializer with the value masked.
    serializers: { req: redactedRequestSerializer },
  },
  bodyLimit: mbToBytes(MAX_BODY_SIZE_MB),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  rewriteUrl: (request) => normalizeProxyPath(request.url ?? "/", PROXY_PATH_PREFIXES),
});

// ─── Rate limiting ───
//
// The store is in-memory and per-process, so this limiter assumes the documented
// single-container deployment: run more than one API replica and each replica
// enforces its own independent budget.
//
// Keying purely on `request.ip` also lumps all Stremio traffic into one bucket.
// The addon is a single container on the internal Docker network, so a phone, an
// Apple TV and a desktop all reach the API from the same address — and a Stremio
// home screen fans out to one request per enabled catalog, so a few clients
// refreshing at once is a burst against a single key. Service-to-service calls
// therefore get their own key and a larger budget.
//
// Identification is a token derived from API_TOKEN rather than API_TOKEN itself.
// The addon authenticates with the same token the browser uses, so the raw token
// can't tell them apart — only something the addon can compute and the browser is
// never given. That also means a leaked browser token can't be used to drain the
// addon's budget, and it needs no extra configuration on either side.

const BROWSER_RATE_LIMIT_MAX = 200;
const SERVICE_RATE_LIMIT_MAX = 1000;
const SERVICE_RATE_LIMIT_KEY = "service:addon";

const SERVICE_TOKEN = process.env.API_TOKEN ? deriveServiceToken(process.env.API_TOKEN) : null;

const isServiceRequest = (request: FastifyRequest): boolean =>
  matchesServiceToken(request.headers[SERVICE_TOKEN_HEADER], SERVICE_TOKEN);

app.register(rateLimit, {
  global: true,
  max: (request) => (isServiceRequest(request) ? SERVICE_RATE_LIMIT_MAX : BROWSER_RATE_LIMIT_MAX),
  timeWindow: "1 minute",
  keyGenerator: (request) => (isServiceRequest(request) ? SERVICE_RATE_LIMIT_KEY : request.ip),
});

// ─── Response caching and compression ───
//
// Order matters and is load-bearing. The caching hook runs first so the ETag is
// computed over the JSON itself, not over whichever content-encoding this
// particular client negotiated — a tag that varied by encoding would never match
// on revalidation. Compression then runs on whatever survived, which is nothing
// at all on a 304.
//
// JSON from this API compresses to roughly a fifth of its size, and the payloads
// that matter most are the big ones: a full watchlist, a long watch history, a
// month of calendar entries.
registerHttpCaching(app);

app.register(compress, {
  global: true,
  // Below about a packet's worth there is nothing to win, and the CPU spent
  // plus the header overhead can leave the response larger than it started.
  threshold: 1024,
  encodings: ["br", "gzip", "deflate"],
});

// ─── Global hooks ───

app.addHook("onRequest", async (request, reply) => {
  applyCorsHeaders(request, reply);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "same-origin");
  if (request.method === "OPTIONS") return reply.code(204).send();
});

// Routes that cannot carry a bearer token by construction: the health probe,
// Stremio's addon URLs (the protocol sends no credentials — an unguessable
// per-profile secret in the path stands in, verified by the route handler), the
// Trakt OAuth callback (a browser redirect from trakt.tv, bound to the flow that
// started it by its `state`), and the Plex/Jellyfin webhooks (their own shared
// secret). Everything else needs `API_TOKEN`.
app.addHook("onRequest", async (request, reply) => {
  const url = request.url;
  if (
    url === "/health" ||
    isStremioSecretPath(url) ||
    url === "/addon" ||
    url.startsWith("/trakt/oauth/callback") ||
    url.startsWith("/webhooks/")
  ) {
    return;
  }
  await verifyToken(request, reply);
});

// ─── Error handling ───

// Every route's error responses are shaped `{ error: "<human-readable>" }`, and
// the web client reads that field. Fastify's built-in 413 isn't — it says
// "Payload Too Large" and leaves someone restoring their own backup with no
// idea that the fix is a single env var — so it's re-shaped here.
app.setErrorHandler((error, request, reply) => {
  if (isBodyTooLargeError(error)) {
    request.log.warn(
      { url: redactUrl(request.url), limitMb: MAX_BODY_SIZE_MB },
      "Rejected a request body larger than MAX_BODY_SIZE_MB"
    );
    return reply.code(413).send({ error: bodyTooLargeMessage(MAX_BODY_SIZE_MB), code: "body_too_large" });
  }
  // Everything else keeps Fastify's default handling (status code, logging and
  // serialization), which is what re-sending the error delegates to.
  return reply.send(error);
});

// ─── Error tracking (opt-in via SENTRY_DSN) ───

Sentry.setupFastifyErrorHandler(app);

// ─── Route registration ───

app.register(healthRoutes);
app.register(profilesRoutes);
app.register(searchRoutes);
app.register(metadataRoutes);
app.register(watchRoutes);
app.register(ratingsRoutes);
app.register(tagsRoutes);
app.register(listsRoutes);
app.register(seriesRoutes);
app.register(calendarRoutes);
app.register(streamingRoutes);
app.register(settingsRoutes);
app.register(aiRoutes);
app.register(stremioRoutes);
app.register(stremioLibraryRoutes);
app.register(traktRoutes);
app.register(scrobbleRoutes);
app.register(pushRoutes);
app.register(notificationRoutes);
app.register(exportRoutes);
app.register(importRoutes);
app.register(plexWebhookRoutes);
app.register(jellyfinWebhookRoutes);
app.register(gamesRoutes);
app.register(gamesSteamRoutes);

// ─── Startup ───

// Recording the failure against the job is the scheduler's business — it is the
// half that knows how long the run took and what it was scheduled against.
const reportBackgroundError = (error: unknown, message: string) => {
  app.log.error(error, message);
  Sentry.captureException(error);
};

const scheduler = { log: app.log, onError: reportBackgroundError };

const start = async () => {
  const port = Number(process.env.PORT ?? 7000);

  if (process.env.NODE_ENV === "production") {
    const startupConfigIssues = [
      !process.env.API_TOKEN && "API_TOKEN is not set",
      process.env.API_TOKEN === "dev-token" && "API_TOKEN is set to the development default \"dev-token\"",
      !process.env.DATABASE_URL && "DATABASE_URL is not set",
      (process.env.DATABASE_URL ?? "").includes(":postgres@") && "DATABASE_URL uses the development default Postgres password",
    ].filter((message): message is string => Boolean(message));

    if (startupConfigIssues.length > 0) {
      app.log.error(
        `Refusing to start in production due to configuration problems: ${startupConfigIssues.join("; ")}. Set real values via your .env file (see README.md).`,
      );
      process.exit(1);
    }
  }

  if (!process.env.WEBHOOK_SECRET?.trim()) {
    app.log.warn("WEBHOOK_SECRET not set — webhook endpoints will reject all requests");
  }

  await ensureDefaultWatchlist();
  await ensureDefaultCollection();
  // Before anything reads a credential, so an API_TOKEN that no longer matches
  // what the database was written under is one startup error rather than a
  // week of integrations failing separately.
  await encryptStoredSecrets(app.log);

  if (TRAKT_POLL_INTERVAL_SEC > 0) {
    everyInterval({
      ...scheduler,
      label: "Trakt poll",
      intervalMs: TRAKT_POLL_INTERVAL_SEC * 1000,
      tick: async ({ runJob }) => {
        const profileId = await getDefaultProfileId();
        await runJob("trakt-history-poll", () => pollTraktHistory(app.log, profileId));
        await runJob("trakt-watchlist-sync", () => syncTraktWatchlist(app.log, profileId));
      },
    });
  } else {
    app.log.info("Scheduled Trakt poll disabled because TRAKT_POLL_INTERVAL_SEC is set to 0");
  }

  if (STREMIO_POLL_INTERVAL_SEC > 0) {
    everyInterval({
      ...scheduler,
      label: "Stremio library sync",
      intervalMs: STREMIO_POLL_INTERVAL_SEC * 1000,
      tick: async ({ runJob }) => {
        // Checked every tick rather than at boot, so connecting an account from
        // Settings starts syncing without a restart.
        if (!(await isStremioConnected())) return;
        // The profile that connected the account, so scheduled watches land
        // where the connect and import routes put theirs. Rows predating that
        // column report null and keep the old default-profile behaviour.
        const profileId = (await getStremioProfileId()) ?? (await getDefaultProfileId());
        await runJob("stremio-library-sync", () => syncStremioLibrary(app.log, profileId, "incremental"));
      },
    });
  } else {
    app.log.info("Scheduled Stremio library sync disabled because STREMIO_POLL_INTERVAL_SEC is set to 0");
  }

  // A pending play signal becomes a watch once its title's runtime has elapsed,
  // so this only needs to run often enough to keep that promotion punctual.
  if (isPlayDetectionEnabled()) {
    everyInterval({
      ...scheduler,
      label: "Stremio play signal settling",
      intervalMs: PLAY_SIGNAL_SETTLE_INTERVAL_MS,
      tick: ({ runJob }) => runJob("stremio-play-signals", () => settleDuePlaySignals(app.log)),
    });
  }

  everyInterval({
    ...scheduler,
    label: "scrobble session cleanup",
    intervalMs: SCROBBLE_CLEANUP_INTERVAL_MS,
    tick: ({ runJob }) => runJob("scrobble-cleanup", () => cleanupStaleSessions(app.log)),
  });

  if (NOTIFICATION_CHECK_INTERVAL_SEC > 0) {
    everyInterval({
      ...scheduler,
      label: "upcoming-episode notification check",
      intervalMs: NOTIFICATION_CHECK_INTERVAL_SEC * 1000,
      tick: ({ runJob }) => runJob("episode-notifications", () => checkUpcomingEpisodesAndNotify(app.log)),
    });
  } else {
    app.log.info(
      "Scheduled episode notification check disabled because NOTIFICATION_CHECK_INTERVAL_SEC is set to 0"
    );
  }

  const refreshAiRecommendations = async () => {
    if (!(await isAiConfigured())) return;
    const profileId = await getDefaultProfileId();
    trendingCacheDeletePrefix("ai-recs:");
    await Promise.allSettled([
      getAiRecommendations("movie", 15, profileId),
      getAiRecommendations("series", 15, profileId),
    ]);
  };

  if (AI_REFRESH_INTERVAL_SEC > 0) {
    everyInterval({
      ...scheduler,
      label: "AI recommendations refresh",
      intervalMs: AI_REFRESH_INTERVAL_SEC * 1000,
      startAfterMs: DEFERRED_FIRST_RUN_MS,
      tick: ({ runJob }) => runJob("ai-recommendations", refreshAiRecommendations),
    });
  } else {
    app.log.info(
      "Scheduled AI recommendations refresh disabled because AI_REFRESH_INTERVAL_SEC is set to 0"
    );
  }

  const refreshSteamLibrary = async () => {
    if (!isSteamSyncConfigured()) return;
    const profileId = await getDefaultProfileId();
    await syncSteamLibrary(app.log, profileId);
  };

  if (STEAM_SYNC_INTERVAL_SEC > 0) {
    everyInterval({
      ...scheduler,
      label: "Steam library sync",
      intervalMs: STEAM_SYNC_INTERVAL_SEC * 1000,
      startAfterMs: DEFERRED_FIRST_RUN_MS,
      tick: ({ runJob }) => runJob("steam-sync", refreshSteamLibrary),
    });
  } else {
    app.log.info(
      "Scheduled Steam library sync disabled because STEAM_SYNC_INTERVAL_SEC is set to 0"
    );
  }

  await app.listen({ port, host: "0.0.0.0" });
};

// ─── Graceful shutdown ───

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutting down API service");

  try {
    await app.close();
    await prisma.$disconnect();
    app.log.info("API service shutdown complete");
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Error during API shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

start().catch(async (error) => {
  app.log.error(error);
  Sentry.captureException(error);
  await prisma.$disconnect();
  process.exit(1);
});
