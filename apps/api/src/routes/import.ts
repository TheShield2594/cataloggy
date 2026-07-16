import { WatchEventType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { resolveProfile } from "../lib/profile.js";
import { getTmdb } from "../lib/tmdb-client.js";
import { parseCsv } from "./export.js";

const parseDate = (v: string | undefined): Date | null => {
  if (!v?.trim()) return null;
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? null : d;
};

const dayRange = (date: Date) => {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
};

// Letterboxd diary/ratings exports don't include IMDb IDs, so we resolve
// title (+ year, when present) against TMDB on a best-effort basis.
const resolveImdbIdByTitle = async (
  title: string,
  year: number | null,
  cache: Map<string, string | null>
): Promise<string | null> => {
  const cacheKey = `${title.toLowerCase()}::${year ?? ""}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  let imdbId: string | null;
  try {
    const tmdb = await getTmdb();
    const results = await tmdb.search("movie", title);
    const match = year ? results.find((r) => r.year === year) : results[0];
    imdbId = (match ?? results[0])?.imdbId ?? null;
  } catch {
    imdbId = null;
  }

  cache.set(cacheKey, imdbId);
  return imdbId;
};

const importRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  app.post<{ Body: unknown }>("/import/external", async (request, reply) => {
    const profileId = request.profileId!;
    const body = request.body as { format?: unknown; csv?: unknown } | null;
    const format = body?.format;
    const csv = typeof body?.csv === "string" ? body.csv : "";

    if (format !== "letterboxd-diary" && format !== "letterboxd-ratings" && format !== "imdb-ratings" && format !== "simkl") {
      return reply.code(400).send({ error: "format must be one of: letterboxd-diary, letterboxd-ratings, imdb-ratings, simkl" });
    }
    if (!csv.trim()) return reply.code(400).send({ error: "csv is required" });

    const rows = parseCsv(csv);
    if (rows.length < 2) return reply.code(400).send({ error: "No data rows found in CSV" });

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const dataRows = rows.slice(1).filter((r) => r.length > 0 && !r.every((c) => c.trim() === ""));
    const col = (name: string) => header.indexOf(name);

    const summary = { imported: 0, ratingsImported: 0, skipped: 0 };
    const titleCache = new Map<string, string | null>();

    if (format === "imdb-ratings") {
      await importImdbRatings(dataRows, col, profileId, summary);
    } else if (format === "simkl") {
      await importSimkl(dataRows, col, profileId, summary);
    } else {
      await importLetterboxd(dataRows, col, profileId, summary, titleCache, format);
    }

    return reply.code(200).send({ status: "imported", format, summary });
  });
};

async function importImdbRatings(
  rows: string[][],
  col: (name: string) => number,
  profileId: string,
  summary: { imported: number; ratingsImported: number; skipped: number }
) {
  // IMDb ratings export header: Const,Your Rating,Date Rated,Title,Title Type,IMDb Rating,...
  const constCol = col("const");
  const ratingCol = col("your rating");
  const dateCol = col("date rated");
  const titleTypeCol = col("title type");
  if (constCol === -1 || ratingCol === -1) {
    throw Object.assign(new Error("Unrecognized IMDb ratings export header"), { code: "BAD_FORMAT" });
  }

  for (const row of rows) {
    const imdbId = row[constCol]?.trim();
    const rating = Number(row[ratingCol]);
    if (!imdbId || !Number.isFinite(rating)) {
      summary.skipped += 1;
      continue;
    }
    const ratedAt = parseDate(row[dateCol]) ?? new Date();
    const titleType = (row[titleTypeCol] ?? "").toLowerCase();
    const type = titleType.includes("tv") ? "series" : "movie";

    await prisma.rating.upsert({
      where: { profileId_type_imdbId_season_episode: { profileId, type, imdbId, season: 0, episode: 0 } },
      create: { profileId, type, imdbId, season: 0, episode: 0, rating, ratedAt },
      update: { rating, ratedAt },
    });
    summary.ratingsImported += 1;
  }
}

async function importSimkl(
  rows: string[][],
  col: (name: string) => number,
  profileId: string,
  summary: { imported: number; ratingsImported: number; skipped: number }
) {
  // Simkl CSV export header: Title,Year,Type,WatchedDate,Rating,ImdbId (column naming varies by export tool;
  // we match loosely on common variants).
  const imdbCol = col("imdbid") !== -1 ? col("imdbid") : col("imdb_id") !== -1 ? col("imdb_id") : col("imdb id");
  const typeCol = col("type");
  const dateCol = col("watcheddate") !== -1 ? col("watcheddate") : col("watched_date") !== -1 ? col("watched_date") : col("watched date");
  const ratingCol = col("rating");
  const seasonCol = col("season");
  const episodeCol = col("episode");

  if (imdbCol === -1) {
    throw Object.assign(new Error("Simkl export must include an imdb id column"), { code: "BAD_FORMAT" });
  }

  for (const row of rows) {
    const imdbId = row[imdbCol]?.trim();
    if (!imdbId) {
      summary.skipped += 1;
      continue;
    }

    const rawType = (typeCol !== -1 ? row[typeCol] : "movie")?.trim().toLowerCase();
    const isEpisode = rawType === "episode" || rawType === "tv" || rawType === "show";
    const season = seasonCol !== -1 && row[seasonCol]?.trim() ? Number(row[seasonCol]) : null;
    const episode = episodeCol !== -1 && row[episodeCol]?.trim() ? Number(row[episodeCol]) : null;

    const watchedAt = dateCol !== -1 ? parseDate(row[dateCol]) : null;
    if (watchedAt) {
      const { start, end } = dayRange(watchedAt);
      const watchType: WatchEventType = isEpisode ? "episode" : "movie";

      const existing = await prisma.watchEvent.findFirst({
        where: {
          profileId,
          type: watchType,
          ...(watchType === "episode" ? { seriesImdbId: imdbId } : { imdbId }),
          season: Number.isFinite(season) ? season : null,
          episode: Number.isFinite(episode) ? episode : null,
          watchedAt: { gte: start, lte: end },
        },
      });

      if (existing) {
        await prisma.watchEvent.update({ where: { id: existing.id }, data: { plays: { increment: 1 } } });
      } else {
        await prisma.watchEvent.create({
          data: {
            type: watchType,
            imdbId,
            seriesImdbId: watchType === "episode" ? imdbId : null,
            season: Number.isFinite(season) ? season : null,
            episode: Number.isFinite(episode) ? episode : null,
            watchedAt,
            profileId,
          },
        });
      }
      summary.imported += 1;
    }

    const rating = ratingCol !== -1 ? Number(row[ratingCol]) : NaN;
    if (Number.isFinite(rating) && rating > 0) {
      const type = isEpisode ? "series" : "movie";
      await prisma.rating.upsert({
        where: { profileId_type_imdbId_season_episode: { profileId, type, imdbId, season: 0, episode: 0 } },
        create: { profileId, type, imdbId, season: 0, episode: 0, rating, ratedAt: watchedAt ?? new Date() },
        update: { rating, ratedAt: watchedAt ?? new Date() },
      });
      summary.ratingsImported += 1;
    }
  }
}

async function importLetterboxd(
  rows: string[][],
  col: (name: string) => number,
  profileId: string,
  summary: { imported: number; ratingsImported: number; skipped: number },
  titleCache: Map<string, string | null>,
  format: "letterboxd-diary" | "letterboxd-ratings"
) {
  // Letterboxd headers: Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
  const nameCol = col("name");
  const yearCol = col("year");
  const ratingCol = col("rating");
  const watchedDateCol = col("watched date") !== -1 ? col("watched date") : col("date");

  if (nameCol === -1) {
    throw Object.assign(new Error("Unrecognized Letterboxd export header"), { code: "BAD_FORMAT" });
  }

  for (const row of rows) {
    const title = row[nameCol]?.trim();
    if (!title) {
      summary.skipped += 1;
      continue;
    }
    const year = yearCol !== -1 && row[yearCol]?.trim() ? Number(row[yearCol]) : null;

    const imdbId = await resolveImdbIdByTitle(title, Number.isFinite(year) ? year : null, titleCache);
    if (!imdbId) {
      summary.skipped += 1;
      continue;
    }

    if (format === "letterboxd-diary") {
      const watchedAt = watchedDateCol !== -1 ? parseDate(row[watchedDateCol]) : null;
      if (watchedAt) {
        const { start, end } = dayRange(watchedAt);
        const existing = await prisma.watchEvent.findFirst({
          where: { profileId, type: "movie", imdbId, watchedAt: { gte: start, lte: end } },
        });
        if (existing) {
          await prisma.watchEvent.update({ where: { id: existing.id }, data: { plays: { increment: 1 } } });
        } else {
          await prisma.watchEvent.create({ data: { type: "movie", imdbId, watchedAt, profileId } });
        }
        summary.imported += 1;
      }
    }

    const rawRating = ratingCol !== -1 ? Number(row[ratingCol]) : NaN;
    if (Number.isFinite(rawRating) && rawRating > 0) {
      // Letterboxd uses a 0.5-5 star scale; normalize to Cataloggy's 1-10 scale.
      const rating = Math.round(rawRating * 2 * 10) / 10;
      const ratedAt = (watchedDateCol !== -1 ? parseDate(row[watchedDateCol]) : null) ?? new Date();
      await prisma.rating.upsert({
        where: { profileId_type_imdbId_season_episode: { profileId, type: "movie", imdbId, season: 0, episode: 0 } },
        create: { profileId, type: "movie", imdbId, season: 0, episode: 0, rating, ratedAt },
        update: { rating, ratedAt },
      });
      summary.ratingsImported += 1;
    }
  }
}

export default importRoutes;
