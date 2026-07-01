import { MetadataType } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "./prisma.js";
import { trendingCacheGet, trendingCacheSet } from "./cache.js";
import { getTmdb } from "./tmdb-client.js";
import { getRpdbApiKey, withRpdbPoster } from "./rpdb.js";
import { upsertMetadata } from "./metadata.js";
import type { AiProviderConfig, StremioMetaPreview } from "./types.js";

export const AI_CONFIG_KEY = "ai:config";
export const AI_LAST_RECS_GENERATED_AT_KEY = "ai:lastRecsGeneratedAt";
export const AI_RECS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Floor for a *saved* config's max_tokens. The per-request generation path
// already computes a higher floor scaled to the requested limit, but this
// keeps the persisted value itself from being set low enough to guarantee
// truncation (e.g. the old UI default of 1024).
export const MIN_AI_CONFIG_MAX_TOKENS = 2048;

export const getAiConfig = async (): Promise<AiProviderConfig | null> => {
  const row = await prisma.kV.findUnique({ where: { key: AI_CONFIG_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as AiProviderConfig;
  } catch {
    return null;
  }
};

export const isAiConfigured = async (): Promise<boolean> => {
  const config = await getAiConfig();
  return !!(config?.url && config?.headers && config?.payload?.model);
};

export const redactAiConfig = (config: AiProviderConfig): AiProviderConfig => ({
  ...config,
  headers: Object.fromEntries(
    Object.entries(config.headers).map(([k, v]) => [
      k,
      k.toLowerCase() === "authorization" ? "Bearer ****" : v,
    ])
  ),
  payload: {
    ...config.payload,
    // Configs saved before MIN_AI_CONFIG_MAX_TOKENS existed may still have a
    // truncation-prone value on disk; reflect the effective (clamped) value
    // here so the settings UI doesn't show a stale number.
    max_tokens:
      typeof config.payload.max_tokens === "number"
        ? Math.max(config.payload.max_tokens, MIN_AI_CONFIG_MAX_TOKENS)
        : config.payload.max_tokens,
  },
});

export const shouldRefreshAiRecs = async (): Promise<boolean> => {
  if (!(await isAiConfigured())) return false;

  const lastGenRow = await prisma.kV.findUnique({ where: { key: AI_LAST_RECS_GENERATED_AT_KEY } });
  if (!lastGenRow) return true;

  const lastGen = new Date(lastGenRow.value);
  if (isNaN(lastGen.getTime())) return true;
  const daysSinceLastGen = (Date.now() - lastGen.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceLastGen >= 7;
};

export const buildTasteProfile = async (profileId?: string) => {
  const recentEvents = await prisma.watchEvent.findMany({
    where: profileId ? { profileId } : undefined,
    orderBy: { watchedAt: "desc" },
    take: 50,
    distinct: ["imdbId"],
    select: { imdbId: true, type: true, seriesImdbId: true },
  });

  const movieIds = recentEvents.filter((e) => e.type === "movie").map((e) => e.imdbId);
  const seriesIds = recentEvents
    .filter((e) => e.type === "episode" && e.seriesImdbId)
    .map((e) => e.seriesImdbId!)
    .filter(Boolean);
  const allIds = [...new Set([...movieIds, ...seriesIds])];

  const allMetadata =
    allIds.length > 0
      ? await prisma.metadata.findMany({
          where: { imdbId: { in: allIds } },
          select: { imdbId: true, name: true, genres: true },
        })
      : [];

  const metaByImdbId = new Map(allMetadata.map((m) => [m.imdbId, m]));

  const ratings = await prisma.rating.findMany({
    where: profileId ? { profileId } : undefined,
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { imdbId: true, rating: true },
  });

  const genreFreq = new Map<string, number>();
  for (const id of allIds) {
    const meta = metaByImdbId.get(id);
    if (meta) {
      for (const g of meta.genres) {
        genreFreq.set(g, (genreFreq.get(g) ?? 0) + 1);
      }
    }
  }
  const topGenres = [...genreFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g);

  const topRated = ratings
    .filter((r) => r.rating >= 8)
    .map((r) => {
      const meta = metaByImdbId.get(r.imdbId);
      return meta ? `${meta.name} (${r.rating}/10)` : null;
    })
    .filter((s): s is string => s !== null)
    .slice(0, 15);

  const recentTitles = recentEvents
    .slice(0, 20)
    .map((e) => {
      const id = e.type === "episode" && e.seriesImdbId ? e.seriesImdbId : e.imdbId;
      return metaByImdbId.get(id)?.name;
    })
    .filter((n): n is string => !!n);

  const watchedImdbIds = new Set(allIds);

  const avgRating =
    ratings.length > 0
      ? Math.round((ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length) * 10) / 10
      : null;

  return { topGenres, topRated, recentTitles, watchedImdbIds, avgRating };
};

const callAiProvider = async (
  config: AiProviderConfig,
  prompt: string,
  minTokens = 0
): Promise<string> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  const configuredMaxTokens = (config.payload.max_tokens as number | undefined) ?? 4096;
  const payload = {
    ...config.payload,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    // Never go below what the requested recommendation count needs, even if the
    // user's saved config specifies a smaller value — a low max_tokens silently
    // truncates the JSON array mid-response, which surfaces as a parse failure.
    max_tokens: Math.max(configuredMaxTokens, minTokens),
  };

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...config.headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`AI provider error (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  let content = data.choices?.[0]?.message?.content ?? "";

  content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  return content;
};

type AiRecItem = { title: string; year?: number; type: "movie" | "series"; reason: string };

const parseRecsFromContent = (content: string): AiRecItem[] => {
  // Try direct parse first (ideal case: AI returned only JSON)
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as AiRecItem[];
  } catch { /* not valid JSON on its own — fall through to bracket-matching */ }

  // Use bracket-matching to extract the first JSON array, avoiding greedy regex
  // overshoot when the AI appends trailing text containing "]"
  const start = content.indexOf("[");
  if (start === -1) {
    // An unterminated <think> block means generation was cut off by max_tokens
    // while still reasoning, before it ever got to the JSON — the fix is more
    // headroom, not better parsing.
    if (/<think>/i.test(content)) {
      throw new Error(
        "AI response was truncated mid-reasoning before producing any output — increase max_tokens"
      );
    }
    throw new Error("No JSON array in AI response");
  }

  let depth = 0;
  let end = -1;
  for (let i = start; i < content.length; i++) {
    if (content[i] === "[") depth++;
    else if (content[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error(
      "AI response was truncated before the JSON array closed — increase max_tokens or lower the recommendation limit"
    );
  }

  try {
    return JSON.parse(content.slice(start, end + 1)) as AiRecItem[];
  } catch (e) {
    throw new Error(`Failed to parse AI response as JSON: ${e}`);
  }
};

export const getAiRecommendations = async (
  type: "movie" | "series",
  limit = 10,
  profileId?: string,
  logger?: FastifyBaseLogger
): Promise<{ metas: StremioMetaPreview[]; reasons: Record<string, string> } | null> => {
  const cacheKey = `ai-recs:${type}:${limit}${profileId ? `:${profileId}` : ""}`;
  const cached = trendingCacheGet(cacheKey);
  if (cached) return { metas: cached.data, reasons: cached.reasons ?? {} };

  const config = await getAiConfig();
  if (!config) return null;

  try {
    const profile = await buildTasteProfile(profileId);
    const avgRatingStr = profile.avgRating !== null ? `${profile.avgRating}/10` : "unrated";
    const typeLabel = type === "movie" ? "movies" : "TV series";

    const prompt = `You are a ${type} recommendation engine with deep knowledge of film and television.

User taste profile:
- Top genres: ${profile.topGenres.join(", ") || "unknown"}
- Highly rated: ${profile.topRated.join(", ") || "none yet"}
- Recently watched: ${profile.recentTitles.join(", ") || "nothing yet"}
- Average rating they give: ${avgRatingStr}

Recommend exactly ${limit} ${typeLabel} this user has NOT already watched. Be specific and varied.

Return ONLY a JSON array, no other text, no markdown:
[
  {
    "title": "exact title",
    "year": release year as number,
    "type": "${type}",
    "reason": "one sentence why based on their taste"
  }
]`;

    // Each recommendation is ~100-150 tokens once title/year/type/reason and JSON
    // punctuation are accounted for; without this floor a low configured
    // max_tokens truncates the array well before `limit` items are reached.
    const minTokens = 400 + limit * 150;
    const content = await callAiProvider(config, prompt, minTokens);
    const recs = parseRecsFromContent(content);

    const tmdb = await getTmdb();
    const metaType = type === "movie" ? MetadataType.movie : MetadataType.series;
    const rpdbKey = await getRpdbApiKey();
    const metas: StremioMetaPreview[] = [];
    const reasons: Record<string, string> = {};

    for (const rec of recs) {
      if (metas.length >= limit) break;
      try {
        const results = await tmdb.search(metaType, rec.title);
        if (!results || results.length === 0) continue;
        const first = results[0];
        if (profile.watchedImdbIds.has(first.imdbId)) continue;
        await upsertMetadata(first);
        metas.push({
          id: first.imdbId,
          type,
          name: first.name,
          poster: withRpdbPoster(first.imdbId, first.poster, rpdbKey) ?? undefined,
          year: first.year ?? undefined,
          description: first.description ?? undefined,
          genres: first.genres,
          rating: first.rating ?? undefined,
        });
        reasons[first.imdbId] = rec.reason;
      } catch (error) {
        logger?.debug({ error, title: rec.title }, "Skipped failed AI recommendation lookup");
      }
    }

    trendingCacheSet(cacheKey, { data: metas, reasons }, AI_RECS_TTL_MS);

    const now = new Date();
    await prisma.kV.upsert({
      where: { key: AI_LAST_RECS_GENERATED_AT_KEY },
      create: { key: AI_LAST_RECS_GENERATED_AT_KEY, value: now.toISOString(), updatedAt: now },
      update: { value: now.toISOString(), updatedAt: now },
    });

    return { metas, reasons };
  } catch (err) {
    logger?.error(err, "AI recommendations generation failed");
    return null;
  }
};
