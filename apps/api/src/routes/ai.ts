import { MetadataType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getTmdb } from "../lib/tmdb-client.js";
import { upsertMetadata } from "../lib/metadata.js";
import { getRpdbApiKey, applyRpdbToMetaList } from "../lib/rpdb.js";
import { trendingCacheDeletePrefix, trendingCacheGet, trendingCacheSet } from "../lib/cache.js";
import {
  AI_CONFIG_KEY,
  AI_LAST_RECS_GENERATED_AT_KEY,
  MIN_AI_CONFIG_MAX_TOKENS,
  getAiConfig,
  isAiConfigured,
  redactAiConfig,
  getAiRecommendations,
} from "../lib/ai.js";
import { resolveProfile } from "../lib/profile.js";
import { getMetadataType } from "../lib/types.js";
import type { StremioMetaPreview, StremioMetaType } from "../lib/types.js";

const aiRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  app.get<{ Querystring: { imdbId?: string; type?: string } }>(
    "/recommendations",
    async (request, reply) => {
      const imdbId = request.query.imdbId?.trim();
      const rawType = request.query.type ?? "movie";
      const type = getMetadataType(rawType);
      if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });
      if (!imdbId) return reply.code(400).send({ error: "imdbId is required" });

      const cacheKey = `recs:${rawType}:${imdbId}`;
      const [cached, rpdbKey] = await Promise.all([
        Promise.resolve(trendingCacheGet(cacheKey)),
        getRpdbApiKey(),
      ]);
      if (cached) return { metas: applyRpdbToMetaList(cached.data, rpdbKey) };

      const meta = await prisma.metadata.findUnique({
        where: { imdbId_type: { imdbId, type } },
        select: { tmdbId: true },
      });

      if (!meta?.tmdbId) {
        try {
          const { fetchMetadata } = await import("../lib/metadata.js");
          const fetched = await fetchMetadata(type, imdbId);
          if (!fetched?.tmdbId) return { metas: [] };
          return await getRecommendations(rawType, type, fetched.tmdbId, cacheKey);
        } catch {
          return { metas: [] };
        }
      }

      return await getRecommendations(rawType, type, meta.tmdbId, cacheKey);
    }
  );

  app.get<{ Querystring: { type?: string; limit?: string } }>(
    "/recommendations/personal",
    async (request) => {
      const rawType = request.query.type ?? "movie";
      const type = getMetadataType(rawType);
      if (!type) return { metas: [] };
      const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 40);
      const profileId = request.profileId!;

      if (await isAiConfigured()) {
        const aiResult = await getAiRecommendations(rawType as "movie" | "series", limit, profileId, request.log);
        if (aiResult) return { metas: aiResult.metas };
      }

      const recentItems =
        rawType === "movie"
          ? await prisma.watchEvent.findMany({
              where: { type: "movie", profileId },
              orderBy: { watchedAt: "desc" },
              take: 5,
              distinct: ["imdbId"],
              select: { imdbId: true },
            })
          : await prisma.seriesProgress.findMany({
              where: { profileId },
              orderBy: { lastWatchedAt: "desc" },
              take: 5,
              select: { seriesImdbId: true },
            });

      const seedImdbIds =
        rawType === "movie"
          ? recentItems.map((r) => (r as { imdbId: string }).imdbId)
          : recentItems.map((r) => (r as { seriesImdbId: string }).seriesImdbId);

      if (seedImdbIds.length === 0) return { metas: [] };

      const metas = await prisma.metadata.findMany({
        where: { imdbId: { in: seedImdbIds }, type },
        select: { tmdbId: true, imdbId: true },
      });

      const tmdbIds = metas.filter((m) => m.tmdbId !== null).map((m) => m.tmdbId as number);
      if (tmdbIds.length === 0) return { metas: [] };

      let tmdb: Awaited<ReturnType<typeof getTmdb>>;
      try {
        tmdb = await getTmdb();
      } catch {
        return { metas: [] };
      }

      const seen = new Set<string>(seedImdbIds);
      const allRecs: StremioMetaPreview[] = [];

      for (const tmdbId of tmdbIds.slice(0, 3)) {
        if (allRecs.length >= limit) break;
        try {
          const seedCacheKey = `recs:seed:${rawType}:${tmdbId}`;
          const cachedSeed = trendingCacheGet(seedCacheKey);
          let recs: Awaited<ReturnType<typeof tmdb.recommendations>>;

          if (cachedSeed) {
            recs = (cachedSeed.data as StremioMetaPreview[]).map((m) => ({
              imdbId: m.id,
              type,
              tmdbId: null,
              name: m.name,
              year: m.year ?? null,
              poster: m.poster ?? null,
              background: null,
              description: m.description ?? null,
              genres: m.genres ?? [],
              rating: m.rating ?? null,
              voteCount: null,
              totalSeasons: null,
              totalEpisodes: null,
              runtime: null,
              certification: null,
              status: null,
              network: null,
              releaseDate: null,
            }));
          } else {
            recs = await tmdb.recommendations(type, tmdbId);
            const seedMetas: StremioMetaPreview[] = recs.map((r) => ({
              id: r.imdbId,
              type: rawType as StremioMetaType,
              name: r.name,
              poster: r.poster ?? undefined,
              year: r.year ?? undefined,
              description: r.description ?? undefined,
              genres: r.genres,
              rating: r.rating ?? undefined,
            }));
            trendingCacheSet(seedCacheKey, { data: seedMetas });
          }

          for (const r of recs) {
            if (allRecs.length >= limit) break;
            if (seen.has(r.imdbId)) continue;
            seen.add(r.imdbId);
            allRecs.push({
              id: r.imdbId,
              type: rawType as StremioMetaType,
              name: r.name,
              poster: r.poster ?? undefined,
              year: r.year ?? undefined,
              description: r.description ?? undefined,
              genres: r.genres,
              rating: r.rating ?? undefined,
            });
            if (r.tmdbId !== null) void upsertMetadata(r);
          }
        } catch { /* skip failed seeds */ }
      }

      const rpdbKey = await getRpdbApiKey();
      return { metas: applyRpdbToMetaList(allRecs.slice(0, limit), rpdbKey) };
    }
  );

  app.get<{ Querystring: { type?: string; limit?: string } }>(
    "/recommendations/ai",
    async (request) => {
      const rawType = request.query.type ?? "movie";
      if (rawType !== "movie" && rawType !== "series") return { metas: [], reasons: {} };
      const type = rawType as "movie" | "series";
      const limit = Math.min(Math.max(Number(request.query.limit) || 10, 1), 20);
      const profileId = request.profileId!;

      if (!(await isAiConfigured())) {
        const recentItems =
          type === "movie"
            ? await prisma.watchEvent.findMany({
                where: { type: "movie", profileId },
                orderBy: { watchedAt: "desc" },
                take: 3,
                distinct: ["imdbId"],
                select: { imdbId: true },
              })
            : await prisma.seriesProgress.findMany({
                where: { profileId },
                orderBy: { lastWatchedAt: "desc" },
                take: 3,
                select: { seriesImdbId: true },
              });

        const seedIds =
          type === "movie"
            ? (recentItems as { imdbId: string }[]).map((r) => r.imdbId)
            : (recentItems as { seriesImdbId: string }[]).map((r) => r.seriesImdbId);

        if (seedIds.length === 0) return { metas: [], reasons: {} };

        const metaType = type === "movie" ? MetadataType.movie : MetadataType.series;
        const seedMetas = await prisma.metadata.findMany({
          where: { imdbId: { in: seedIds }, type: metaType },
          select: { tmdbId: true },
        });
        const tmdbIds = seedMetas.filter((m) => m.tmdbId).map((m) => m.tmdbId as number);
        if (tmdbIds.length === 0) return { metas: [], reasons: {} };

        try {
          const tmdb = await getTmdb();
          const seen = new Set<string>(seedIds);
          const allRecs: StremioMetaPreview[] = [];
          for (const tmdbId of tmdbIds.slice(0, 3)) {
            if (allRecs.length >= limit) break;
            const recs = await tmdb.recommendations(metaType, tmdbId);
            for (const r of recs) {
              if (allRecs.length >= limit) break;
              if (seen.has(r.imdbId)) continue;
              seen.add(r.imdbId);
              allRecs.push({
                id: r.imdbId,
                type,
                name: r.name,
                poster: r.poster ?? undefined,
                year: r.year ?? undefined,
                description: r.description ?? undefined,
                genres: r.genres,
                rating: r.rating ?? undefined,
              });
            }
          }
          const rpdbKey = await getRpdbApiKey();
          return { metas: applyRpdbToMetaList(allRecs.slice(0, limit), rpdbKey), reasons: {} };
        } catch {
          return { metas: [], reasons: {} };
        }
      }

      const result = await getAiRecommendations(type, limit, profileId, request.log);
      if (!result) return { metas: [], reasons: {} };
      return { metas: result.metas, reasons: result.reasons };
    }
  );

  app.post("/recommendations/ai/refresh", async () => {
    trendingCacheDeletePrefix("ai-recs:");
    return { refreshed: true };
  });

  // ─── Trending / Popular ───

  app.get<{ Querystring: { type?: string; window?: string } }>(
    "/trending",
    async (request, reply) => {
      const rawType = request.query.type ?? "movie";
      const type = getMetadataType(rawType);
      if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });

      const timeWindow = request.query.window === "day" ? ("day" as const) : ("week" as const);
      const cacheKey = `trending:${rawType}:${timeWindow}`;

      const [cached, rpdbKey] = await Promise.all([
        Promise.resolve(trendingCacheGet(cacheKey)),
        getRpdbApiKey(),
      ]);
      if (cached) return { metas: applyRpdbToMetaList(cached.data, rpdbKey) };

      try {
        const tmdb = await getTmdb();
        const results = await tmdb.trending(type, timeWindow);
        await Promise.all(results.map((r) => upsertMetadata(r)));
        const metas: StremioMetaPreview[] = results.map((r) => ({
          id: r.imdbId,
          type: rawType as StremioMetaType,
          name: r.name,
          poster: r.poster ?? undefined,
          year: r.year ?? undefined,
          description: r.description ?? undefined,
          genres: r.genres,
          rating: r.rating ?? undefined,
        }));
        trendingCacheSet(cacheKey, { data: metas });
        return { metas: applyRpdbToMetaList(metas, rpdbKey) };
      } catch (error) {
        request.log.error(error, "Trending fetch failed");
        return reply.code(500).send({ error: "Failed to fetch trending content" });
      }
    }
  );

  app.get<{ Querystring: { type?: string } }>("/popular", async (request, reply) => {
    const rawType = request.query.type ?? "movie";
    const type = getMetadataType(rawType);
    if (!type) return reply.code(400).send({ error: "type must be one of: movie, series" });

    const cacheKey = `popular:${rawType}`;
    const [cached, rpdbKey] = await Promise.all([
      Promise.resolve(trendingCacheGet(cacheKey)),
      getRpdbApiKey(),
    ]);
    if (cached) return { metas: applyRpdbToMetaList(cached.data, rpdbKey) };

    try {
      const tmdb = await getTmdb();
      const results = await tmdb.popular(type);
      await Promise.all(results.map((r) => upsertMetadata(r)));
      const metas: StremioMetaPreview[] = results.map((r) => ({
        id: r.imdbId,
        type: rawType as StremioMetaType,
        name: r.name,
        poster: r.poster ?? undefined,
        year: r.year ?? undefined,
        description: r.description ?? undefined,
        genres: r.genres,
        rating: r.rating ?? undefined,
      }));
      trendingCacheSet(cacheKey, { data: metas });
      return { metas: applyRpdbToMetaList(metas, rpdbKey) };
    } catch (error) {
      request.log.error(error, "Popular fetch failed");
      return reply.code(500).send({ error: "Failed to fetch popular content" });
    }
  });

  // ─── AI Config ───

  app.get("/ai/config", async () => {
    const config = await getAiConfig();
    const configured = !!(config?.url && config?.headers && config?.payload?.model);
    const lastGenRow = await prisma.kV.findUnique({
      where: { key: AI_LAST_RECS_GENERATED_AT_KEY },
    });
    return {
      configured,
      config: configured ? redactAiConfig(config!) : null,
      lastGeneratedAt: lastGenRow?.value ?? null,
    };
  });

  app.post<{ Body: unknown }>("/ai/config", async (request, reply) => {
    const body = request.body as { config?: unknown } | null;
    const cfg = body?.config as Record<string, unknown> | undefined;

    if (!cfg || typeof cfg.url !== "string" || !cfg.url.startsWith("http")) {
      return reply.code(400).send({
        error: "config.url must be a non-empty string starting with http",
      });
    }
    if (!cfg.headers || typeof cfg.headers !== "object" || Array.isArray(cfg.headers)) {
      return reply.code(400).send({ error: "config.headers must be an object" });
    }
    if (!cfg.payload || typeof cfg.payload !== "object" || Array.isArray(cfg.payload)) {
      return reply.code(400).send({ error: "config.payload must be an object" });
    }

    const payload = cfg.payload as Record<string, unknown>;
    if (typeof payload.model !== "string" || !payload.model) {
      return reply.code(400).send({
        error: "config.payload.model must be a non-empty string",
      });
    }

    if (payload.max_tokens !== undefined) {
      const maxTokens = Number(payload.max_tokens);
      if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
        return reply.code(400).send({
          error: "config.payload.max_tokens must be a positive number",
        });
      }
      // Clamp low values up rather than rejecting them — a value under this
      // floor reliably truncates recommendation responses mid-JSON.
      payload.max_tokens = Math.max(maxTokens, MIN_AI_CONFIG_MAX_TOKENS);
    }

    const validConfig = {
      url: cfg.url,
      headers: cfg.headers as Record<string, string>,
      payload,
    };

    await prisma.kV.upsert({
      where: { key: AI_CONFIG_KEY },
      create: { key: AI_CONFIG_KEY, value: JSON.stringify(validConfig), updatedAt: new Date() },
      update: { value: JSON.stringify(validConfig), updatedAt: new Date() },
    });

    trendingCacheDeletePrefix("ai-recs:");

    return { configured: true };
  });

  app.delete("/ai/config", async () => {
    await prisma.kV.deleteMany({ where: { key: { in: [AI_CONFIG_KEY, AI_LAST_RECS_GENERATED_AT_KEY] } } });
    trendingCacheDeletePrefix("ai-recs:");
    return { configured: false };
  });

  app.post<{ Body: unknown }>("/ai/test", async (request) => {
    const body = request.body as { config?: unknown } | null;
    const cfg = body?.config as Record<string, unknown> | undefined;

    if (
      !cfg ||
      typeof cfg.url !== "string" ||
      !cfg.url.startsWith("http") ||
      !cfg.headers ||
      typeof cfg.headers !== "object" ||
      Array.isArray(cfg.headers) ||
      !cfg.payload ||
      typeof cfg.payload !== "object" ||
      Array.isArray(cfg.payload) ||
      typeof (cfg.payload as Record<string, unknown>).model !== "string"
    ) {
      return { success: false, error: "Invalid config: url, headers, and payload.model are required" };
    }

    const testConfig = {
      url: cfg.url,
      headers: cfg.headers as Record<string, string>,
      payload: {
        ...(cfg.payload as Record<string, unknown>),
        messages: [{ role: "user", content: "Reply with the single word OK and nothing else. No punctuation." }],
        stream: false,
        max_tokens: 20,
      },
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        response = await fetch(testConfig.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...testConfig.headers },
          body: JSON.stringify(testConfig.payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        return { success: false, error: `HTTP ${response.status}: ${errBody.slice(0, 200)}` };
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = (data.choices?.[0]?.message?.content ?? "").trim().slice(0, 100);
      return { success: true, response: content };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
};

async function getRecommendations(
  rawType: string,
  type: import("@prisma/client").MetadataType,
  tmdbId: number,
  cacheKey: string
) {
  try {
    const tmdb = await getTmdb();
    const results = await tmdb.recommendations(type, tmdbId);
    await Promise.all(results.map((r) => upsertMetadata(r)));
    const metas: StremioMetaPreview[] = results.map((r) => ({
      id: r.imdbId,
      type: rawType as StremioMetaType,
      name: r.name,
      poster: r.poster ?? undefined,
      year: r.year ?? undefined,
      description: r.description ?? undefined,
      genres: r.genres,
      rating: r.rating ?? undefined,
    }));
    trendingCacheSet(cacheKey, { data: metas });
    const rpdbKey = await getRpdbApiKey();
    return { metas: applyRpdbToMetaList(metas, rpdbKey) };
  } catch {
    return { metas: [] };
  }
}

export default aiRoutes;
