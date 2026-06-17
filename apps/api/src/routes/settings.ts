import { STREAMING_PROVIDERS } from "../tmdb.js";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import {
  LANGUAGE_KV_KEY,
  REGION_KV_KEY,
  SPOILER_PROTECTION_KV_KEY,
  getLanguageSetting,
  getRegionSetting,
  getSpoilerProtection,
} from "../lib/settings.js";
import { OMDB_API_KEY_KV, getOmdbApiKey } from "../lib/omdb.js";
import { RPDB_API_KEY_KV, getRpdbApiKey, buildRpdbPosterUrl } from "../lib/rpdb.js";
import { trendingCache } from "../lib/cache.js";

const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/settings/preferences", async () => {
    const [language, region, spoilerProtection] = await Promise.all([
      getLanguageSetting(),
      getRegionSetting(),
      getSpoilerProtection(),
    ]);
    return {
      language,
      region,
      spoilerProtection,
      availableProviders: Object.entries(STREAMING_PROVIDERS).map(([key, val]) => ({ key, ...val })),
    };
  });

  app.post<{ Body: unknown }>("/settings/preferences", async (request, reply) => {
    const body = request.body as {
      language?: unknown;
      region?: unknown;
      spoilerProtection?: unknown;
    } | null;
    if (!body) return reply.code(400).send({ error: "Body is required" });

    const LANGUAGE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
    const REGION_PATTERN = /^[A-Z]{2}$/;
    const now = new Date();

    if (typeof body.language === "string" && body.language.trim()) {
      const raw = body.language.trim();
      const parts = raw.split("-");
      const normalizedLang =
        parts.length === 2
          ? `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`
          : parts[0].toLowerCase();
      if (!LANGUAGE_PATTERN.test(normalizedLang)) {
        return reply.code(400).send({
          error: "language must be a valid language code (e.g., 'en-US', 'fr')",
        });
      }
      await prisma.kV.upsert({
        where: { key: LANGUAGE_KV_KEY },
        create: { key: LANGUAGE_KV_KEY, value: normalizedLang, updatedAt: now },
        update: { value: normalizedLang, updatedAt: now },
      });
    }

    if (typeof body.region === "string" && body.region.trim()) {
      const reg = body.region.trim().toUpperCase();
      if (!REGION_PATTERN.test(reg)) {
        return reply.code(400).send({
          error: "region must be a valid two-letter country code (e.g., 'US', 'GB')",
        });
      }
      await prisma.kV.upsert({
        where: { key: REGION_KV_KEY },
        create: { key: REGION_KV_KEY, value: reg, updatedAt: now },
        update: { value: reg, updatedAt: now },
      });
    }

    if (typeof body.spoilerProtection === "boolean") {
      await prisma.kV.upsert({
        where: { key: SPOILER_PROTECTION_KV_KEY },
        create: {
          key: SPOILER_PROTECTION_KV_KEY,
          value: String(body.spoilerProtection),
          updatedAt: now,
        },
        update: { value: String(body.spoilerProtection), updatedAt: now },
      });
    }

    trendingCache.clear();

    const [language, region, spoilerProtection] = await Promise.all([
      getLanguageSetting(),
      getRegionSetting(),
      getSpoilerProtection(),
    ]);
    return { language, region, spoilerProtection };
  });

  // ─── TMDB ───
  // TMDB_API_KEY is a deployment-time secret (no UI to set it), so this
  // is informational only — used by the setup wizard to surface whether
  // the server is configured, not to let the browser configure it.
  app.get("/tmdb/status", async () => {
    return { configured: !!process.env.TMDB_API_KEY?.trim() };
  });

  // ─── OMDB ───

  app.get("/omdb/status", async () => {
    const apiKey = await getOmdbApiKey();
    return { configured: !!apiKey };
  });

  app.post<{ Body: unknown }>("/omdb/key", async (request, reply) => {
    const body = request.body as { apiKey?: unknown } | null;
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) {
      await prisma.kV.deleteMany({ where: { key: OMDB_API_KEY_KV } });
      return { configured: false };
    }

    try {
      const testUrl = `https://www.omdbapi.com/?i=tt0111161&apikey=${encodeURIComponent(apiKey)}`;
      const testRes = await fetch(testUrl, { signal: AbortSignal.timeout(8000) });
      const testData = await testRes.json() as { Response?: string; Error?: string };
      if (testData.Response === "False") {
        return reply.code(400).send({ error: testData.Error ?? "Invalid OMDB API key" });
      }
    } catch {
      return reply.code(400).send({ error: "Could not reach OMDB API to validate key" });
    }

    await prisma.kV.upsert({
      where: { key: OMDB_API_KEY_KV },
      create: { key: OMDB_API_KEY_KV, value: apiKey, updatedAt: new Date() },
      update: { value: apiKey, updatedAt: new Date() },
    });
    return { configured: true };
  });

  app.delete("/omdb/key", async () => {
    await prisma.kV.deleteMany({ where: { key: OMDB_API_KEY_KV } });
    return { configured: false };
  });

  // ─── RPDB ───

  app.get("/rpdb/status", async () => {
    const apiKey = await getRpdbApiKey();
    return { configured: !!apiKey, hasKey: !!apiKey };
  });

  app.post<{ Body: unknown }>("/rpdb/key", async (request, reply) => {
    const body = request.body as { apiKey?: unknown } | null;
    if (!body || typeof body.apiKey !== "string") {
      return reply.code(400).send({ error: "apiKey must be a string" });
    }

    const apiKey = body.apiKey.trim();
    if (!apiKey) {
      await prisma.kV.deleteMany({ where: { key: RPDB_API_KEY_KV } });
      return { configured: false };
    }

    await prisma.kV.upsert({
      where: { key: RPDB_API_KEY_KV },
      create: { key: RPDB_API_KEY_KV, value: apiKey, updatedAt: new Date() },
      update: { value: apiKey, updatedAt: new Date() },
    });
    return { configured: true };
  });

  app.delete("/rpdb/key", async () => {
    await prisma.kV.deleteMany({ where: { key: RPDB_API_KEY_KV } });
    return { configured: false };
  });

  app.get<{ Params: { imdbId: string } }>("/rpdb/poster/:imdbId", async (request, reply) => {
    const rpdbKey = await getRpdbApiKey();
    if (!rpdbKey) return reply.code(404).send({ error: "RPDB not configured" });
    return { poster: buildRpdbPosterUrl(rpdbKey, request.params.imdbId) };
  });

  app.get("/rpdb/config", async () => {
    const apiKey = await getRpdbApiKey();
    return { enabled: !!apiKey, apiKey: apiKey ?? null };
  });
};

export default settingsRoutes;
