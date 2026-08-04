import { WatchEventType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { resolveProfile } from "../lib/profile.js";
import { getTmdb } from "../lib/tmdb-client.js";
import { batchUpsertWatchEvents, type WatchEventInput } from "../lib/batch-watch-events.js";
import { batchUpsertRatings, type RatingInput } from "../lib/batch-ratings.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import {
  boundedInt,
  boundedNumber,
  MAX_EPISODE,
  MAX_IMPORT_ROWS,
  MAX_RATING,
  MAX_SEASON,
  MIN_RATING,
  normalizeImdbId,
  tooManyRowsMessage,
} from "../lib/import-validation.js";
import { parseCsv } from "./export.js";

const TMDB_LOOKUP_CONCURRENCY = 5;

/**
 * The Letterboxd formats carry no IMDb ids, so every unique title costs a TMDB
 * search — outbound work against someone else's rate-limited API, not just a
 * local row. They get a much lower ceiling than the id-carrying formats; 10k
 * films is well past any real diary export.
 */
const MAX_TMDB_LOOKUP_ROWS = 10_000;

const parseDate = (v: string | undefined): Date | null => {
  if (!v?.trim()) return null;
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? null : d;
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
    // TMDB is an upstream we don't control — an id from it gets the same
    // format check as one typed into a CSV column.
    imdbId = normalizeImdbId((match ?? results[0])?.imdbId);
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
    // Bounded on top of MAX_BODY_SIZE_MB: row count, not payload size, is what
    // a single request's work scales with — and for Letterboxd that work
    // includes a TMDB search per unique title.
    const rowLimit = format.startsWith("letterboxd") ? MAX_TMDB_LOOKUP_ROWS : MAX_IMPORT_ROWS;
    if (dataRows.length > rowLimit) {
      return reply.code(413).send({ error: tooManyRowsMessage("CSV rows", rowLimit), code: "too_many_rows" });
    }
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

  const ratingInputs: RatingInput[] = [];

  for (const row of rows) {
    const imdbId = normalizeImdbId(row[constCol]);
    const rating = boundedNumber(row[ratingCol], MIN_RATING, MAX_RATING);
    if (!imdbId || rating === null) {
      summary.skipped += 1;
      continue;
    }
    const ratedAt = parseDate(row[dateCol]) ?? new Date();
    const titleType = (row[titleTypeCol] ?? "").toLowerCase();
    const type = titleType.includes("tv") ? "series" : "movie";

    ratingInputs.push({ type, imdbId, season: 0, episode: 0, rating, ratedAt });
    summary.ratingsImported += 1;
  }

  await batchUpsertRatings(profileId, ratingInputs);
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

  const watchInputs: WatchEventInput[] = [];
  const ratingInputs: RatingInput[] = [];

  for (const row of rows) {
    const imdbId = normalizeImdbId(row[imdbCol]);
    if (!imdbId) {
      summary.skipped += 1;
      continue;
    }

    const rawType = (typeCol !== -1 ? row[typeCol] : "movie")?.trim().toLowerCase();
    const isEpisode = rawType === "episode" || rawType === "tv" || rawType === "show";
    const rawSeason = seasonCol !== -1 ? row[seasonCol]?.trim() : "";
    const rawEpisode = episodeCol !== -1 ? row[episodeCol]?.trim() : "";
    const season = rawSeason ? boundedInt(rawSeason, 0, MAX_SEASON) : null;
    const episode = rawEpisode ? boundedInt(rawEpisode, 0, MAX_EPISODE) : null;
    // A season/episode the column can't hold makes the row ambiguous, not just
    // imprecise — skip it rather than filing the watch under "no episode".
    if ((rawSeason && season === null) || (rawEpisode && episode === null)) {
      summary.skipped += 1;
      continue;
    }

    const watchedAt = dateCol !== -1 ? parseDate(row[dateCol]) : null;
    if (watchedAt) {
      const watchType: WatchEventType = isEpisode ? "episode" : "movie";
      watchInputs.push({
        type: watchType,
        imdbId,
        seriesImdbId: watchType === "episode" ? imdbId : null,
        season,
        episode,
        watchedAt,
      });
      summary.imported += 1;
    }

    const rating = ratingCol !== -1 ? boundedNumber(row[ratingCol], MIN_RATING, MAX_RATING) : null;
    if (rating !== null && rating > 0) {
      ratingInputs.push({
        type: isEpisode ? "series" : "movie",
        imdbId,
        season: 0,
        episode: 0,
        rating,
        ratedAt: watchedAt ?? new Date(),
      });
      summary.ratingsImported += 1;
    }
  }

  await batchUpsertWatchEvents(profileId, watchInputs);
  await batchUpsertRatings(profileId, ratingInputs);
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

  // Title -> IMDb id resolution is a TMDB search per unique title; run it with bounded
  // concurrency instead of one-at-a-time (which can take minutes for a few hundred rows).
  const resolvedImdbIds = await mapWithConcurrency(rows, TMDB_LOOKUP_CONCURRENCY, async (row) => {
    const title = row[nameCol]?.trim();
    if (!title) return null;
    const year = yearCol !== -1 ? boundedInt(row[yearCol], 1800, 2999) : null;
    return resolveImdbIdByTitle(title, year, titleCache);
  });

  const watchInputs: WatchEventInput[] = [];
  const ratingInputs: RatingInput[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const title = row[nameCol]?.trim();
    if (!title) {
      summary.skipped += 1;
      continue;
    }

    const imdbId = resolvedImdbIds[i];
    if (!imdbId) {
      summary.skipped += 1;
      continue;
    }

    if (format === "letterboxd-diary") {
      const watchedAt = watchedDateCol !== -1 ? parseDate(row[watchedDateCol]) : null;
      if (watchedAt) {
        watchInputs.push({ type: "movie", imdbId, seriesImdbId: null, season: null, episode: null, watchedAt });
        summary.imported += 1;
      }
    }

    // Letterboxd uses a 0.5-5 star scale; normalize to Cataloggy's 1-10 scale.
    const rawRating = ratingCol !== -1 ? boundedNumber(row[ratingCol], MIN_RATING, MAX_RATING / 2) : null;
    if (rawRating !== null && rawRating > 0) {
      const rating = Math.round(rawRating * 2 * 10) / 10;
      const ratedAt = (watchedDateCol !== -1 ? parseDate(row[watchedDateCol]) : null) ?? new Date();
      ratingInputs.push({ type: "movie", imdbId, season: 0, episode: 0, rating, ratedAt });
      summary.ratingsImported += 1;
    }
  }

  await batchUpsertWatchEvents(profileId, watchInputs);
  await batchUpsertRatings(profileId, ratingInputs);
}

export default importRoutes;
