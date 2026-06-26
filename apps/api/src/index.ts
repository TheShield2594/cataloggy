import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { parseProxyPathPrefixes, normalizeProxyPath, parseTrustProxy } from "@cataloggy/shared";
import { prisma } from "./lib/prisma.js";
import { applyCorsHeaders } from "./lib/cors.js";
import { verifyToken } from "./lib/auth.js";
import { getAiRecommendations, isAiConfigured } from "./lib/ai.js";
import { trendingCacheDeletePrefix } from "./lib/cache.js";
import { pollTraktHistory, syncTraktWatchlist } from "./lib/trakt-client.js";
import { ensureDefaultWatchlist } from "./lib/watchlist.js";
import { getDefaultProfileId } from "./lib/profile.js";
import { checkUpcomingEpisodesAndNotify } from "./lib/notify-episodes.js";
import { cleanupStaleSessions, SCROBBLE_CLEANUP_INTERVAL_MS } from "./routes/scrobble.js";

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
import traktRoutes from "./routes/trakt.js";
import scrobbleRoutes from "./routes/scrobble.js";
import pushRoutes from "./routes/push.js";
import exportRoutes from "./routes/export.js";
import importRoutes from "./routes/import.js";
import plexWebhookRoutes from "./routes/webhooks/plex.js";
import jellyfinWebhookRoutes from "./routes/webhooks/jellyfin.js";

const TRAKT_POLL_INTERVAL_SEC = Number(process.env.TRAKT_POLL_INTERVAL_SEC ?? 300);
const AI_REFRESH_INTERVAL_SEC = Number(process.env.AI_REFRESH_INTERVAL_SEC ?? 86400);
const NOTIFICATION_CHECK_INTERVAL_SEC = Number(process.env.NOTIFICATION_CHECK_INTERVAL_SEC ?? 3600);

const PROXY_PATH_PREFIXES = parseProxyPathPrefixes(process.env.PROXY_PATH_PREFIXES, ["/api"] as const);

const app = Fastify({
  logger: true,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  rewriteUrl: (request) => normalizeProxyPath(request.url ?? "/", PROXY_PATH_PREFIXES),
});

// ─── Rate limiting ───

app.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: "1 minute",
  keyGenerator: (request) => request.ip,
});

// ─── Global hooks ───

app.addHook("onRequest", async (request, reply) => {
  applyCorsHeaders(request, reply);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "same-origin");
  if (request.method === "OPTIONS") return reply.code(204).send();
});

app.addHook("onRequest", async (request, reply) => {
  const url = request.url;
  if (
    url === "/health" ||
    url.startsWith("/addon/stremio") ||
    url === "/addon" ||
    url.startsWith("/trakt/oauth/callback") ||
    url.startsWith("/webhooks/")
  ) {
    return;
  }
  await verifyToken(request, reply);
});

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
app.register(traktRoutes);
app.register(scrobbleRoutes);
app.register(pushRoutes);
app.register(exportRoutes);
app.register(importRoutes);
app.register(plexWebhookRoutes);
app.register(jellyfinWebhookRoutes);

// ─── Startup ───

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

  if (TRAKT_POLL_INTERVAL_SEC > 0) {
    setInterval(() => {
      void (async () => {
        const profileId = await getDefaultProfileId();
        await pollTraktHistory(app.log, profileId).catch((error) => {
          app.log.error(error, "Scheduled Trakt history poll failed");
        });
        await syncTraktWatchlist(app.log, profileId).catch((error) => {
          app.log.error(error, "Scheduled Trakt watchlist sync failed");
        });
      })().catch((error) => {
        app.log.error(error, "Scheduled Trakt poll failed");
      });
    }, TRAKT_POLL_INTERVAL_SEC * 1000);
  } else {
    app.log.info("Scheduled Trakt poll disabled because TRAKT_POLL_INTERVAL_SEC is set to 0");
  }

  setInterval(() => {
    void cleanupStaleSessions(app.log).catch((error) => {
      app.log.error(error, "Scrobble session cleanup failed");
    });
  }, SCROBBLE_CLEANUP_INTERVAL_MS);

  if (NOTIFICATION_CHECK_INTERVAL_SEC > 0) {
    setInterval(() => {
      void checkUpcomingEpisodesAndNotify(app.log).catch((error) => {
        app.log.error(error, "Scheduled upcoming-episode notification check failed");
      });
    }, NOTIFICATION_CHECK_INTERVAL_SEC * 1000);
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
    setTimeout(() => {
      void refreshAiRecommendations().catch((error) => {
        app.log.error(error, "Initial AI recommendations refresh failed");
      });
      setInterval(() => {
        void refreshAiRecommendations().catch((error) => {
          app.log.error(error, "Scheduled AI recommendations refresh failed");
        });
      }, AI_REFRESH_INTERVAL_SEC * 1000);
    }, 2 * 60 * 1000);
  } else {
    app.log.info(
      "Scheduled AI recommendations refresh disabled because AI_REFRESH_INTERVAL_SEC is set to 0"
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
  await prisma.$disconnect();
  process.exit(1);
});
