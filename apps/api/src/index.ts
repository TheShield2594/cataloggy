import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
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
import plexWebhookRoutes from "./routes/webhooks/plex.js";
import jellyfinWebhookRoutes from "./routes/webhooks/jellyfin.js";

const TRAKT_POLL_INTERVAL_SEC = Number(process.env.TRAKT_POLL_INTERVAL_SEC ?? 300);
const AI_REFRESH_INTERVAL_SEC = Number(process.env.AI_REFRESH_INTERVAL_SEC ?? 86400);
const NOTIFICATION_CHECK_INTERVAL_SEC = Number(process.env.NOTIFICATION_CHECK_INTERVAL_SEC ?? 3600);

const parseProxyPathPrefixes = (raw: string | undefined, fallback: readonly string[]) => {
  const parsed = (raw ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean)
    .map((prefix) => (prefix.startsWith("/") ? prefix : `/${prefix}`));

  return parsed.length > 0 ? parsed : [...fallback];
};

const PROXY_PATH_PREFIXES = parseProxyPathPrefixes(process.env.PROXY_PATH_PREFIXES, ["/api"] as const);

const stripProxyPrefix = (url: string, prefix: string) => {
  if (url === prefix) return "/";
  if (!url.startsWith(`${prefix}/`)) return null;
  return url.slice(prefix.length) || "/";
};

const normalizeProxyPath = (rawUrl: string) => {
  for (const prefix of PROXY_PATH_PREFIXES) {
    const stripped = stripProxyPrefix(rawUrl, prefix);
    if (stripped) return stripped;
  }
  return rawUrl;
};

// Only trust X-Forwarded-* headers from explicitly configured proxies, so
// request.ip (used as the rate-limit key) can't be spoofed by clients when
// there's no reverse proxy in front of this service.
const parseTrustProxy = (raw: string | undefined): boolean | string[] | undefined => {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
};

const app = Fastify({
  logger: true,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  rewriteUrl: (request) => normalizeProxyPath(request.url ?? "/"),
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
app.register(plexWebhookRoutes);
app.register(jellyfinWebhookRoutes);

// ─── Startup ───

const start = async () => {
  const port = Number(process.env.PORT ?? 7000);

  if (process.env.NODE_ENV === "production") {
    const insecureDefaults = [
      process.env.API_TOKEN === "dev-token" && "API_TOKEN is set to the development default \"dev-token\"",
      (process.env.DATABASE_URL ?? "").includes(":postgres@") && "DATABASE_URL uses the development default Postgres password",
    ].filter((message): message is string => Boolean(message));

    if (insecureDefaults.length > 0) {
      app.log.error(
        `Refusing to start in production with insecure defaults: ${insecureDefaults.join("; ")}. Set real secrets via your .env file (see README.md).`,
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
    void cleanupStaleSessions().catch((error) => {
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
    trendingCacheDeletePrefix("ai-recs:");
    await Promise.allSettled([
      getAiRecommendations("movie", 15),
      getAiRecommendations("series", 15),
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
