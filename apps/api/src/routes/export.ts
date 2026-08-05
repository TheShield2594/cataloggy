import { ListItemType, ListKind, MetadataType, WatchEventType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { resolveProfile } from "../lib/profile.js";
import { batchUpsertSeriesProgressIfNewer } from "../lib/series-progress.js";
import type { SeriesProgressCandidate } from "../lib/types.js";
import { getDefaultWatchlist } from "../lib/watchlist.js";
import { batchUpsertWatchEvents, type WatchEventInput } from "../lib/batch-watch-events.js";
import { batchUpsertRatings, type RatingInput } from "../lib/batch-ratings.js";
import {
  boundedInt,
  boundedNumber,
  isRecord,
  MAX_EPISODE,
  MAX_IMPORT_ROWS,
  MAX_PLAYS,
  MAX_RATING,
  MAX_SEASON,
  MIN_RATING,
  normalizeImdbId,
  tooManyRowsMessage,
} from "../lib/import-validation.js";

const EXPORT_VERSION = 1;

interface ExportListItem {
  type: ListItemType;
  imdbId: string;
  addedAt: string;
}

interface ExportList {
  name: string;
  kind: ListKind;
  items: ExportListItem[];
}

interface ExportWatchEvent {
  type: WatchEventType;
  imdbId: string;
  seriesImdbId: string | null;
  season: number | null;
  episode: number | null;
  watchedAt: string;
  plays: number;
  note?: string | null;
}

interface ExportSeriesProgress {
  seriesImdbId: string;
  lastSeason: number;
  lastEpisode: number;
  lastWatchedAt: string;
}

interface ExportRating {
  imdbId: string;
  type: string;
  season?: number;
  episode?: number;
  rating: number;
  note?: string | null;
  ratedAt: string;
}

interface ExportPayload {
  version: number;
  exportedAt: string;
  profile: { name: string };
  lists: ExportList[];
  watchEvents: ExportWatchEvent[];
  seriesProgress: ExportSeriesProgress[];
  ratings: ExportRating[];
}

const isString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const parseDate = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const exportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  app.get("/export", async (request) => {
    const profileId = request.profileId!;

    const [profile, lists, watchEvents, seriesProgress, ratingRows] = await Promise.all([
      prisma.profile.findUnique({ where: { id: profileId }, select: { name: true } }),
      prisma.list.findMany({
        where: { profileId },
        include: { items: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.watchEvent.findMany({ where: { profileId }, orderBy: { watchedAt: "asc" } }),
      prisma.seriesProgress.findMany({ where: { profileId } }),
      prisma.rating.findMany({ where: { profileId } }),
    ]);

    const ratings: ExportRating[] = ratingRows.map((row) => ({
      imdbId: row.imdbId,
      type: row.type,
      season: row.type === "season" || row.type === "episode" ? row.season : undefined,
      episode: row.type === "episode" ? row.episode : undefined,
      rating: row.rating,
      note: row.note,
      ratedAt: row.ratedAt.toISOString(),
    }));

    const payload: ExportPayload = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      profile: { name: profile?.name ?? "Default" },
      lists: lists.map((list) => ({
        name: list.name,
        kind: list.kind,
        items: (list.items as { type: ListItemType; imdbId: string; addedAt: Date }[]).map((item) => ({
          type: item.type,
          imdbId: item.imdbId,
          addedAt: item.addedAt.toISOString(),
        })),
      })),
      watchEvents: watchEvents.map((event) => ({
        type: event.type,
        imdbId: event.imdbId,
        seriesImdbId: event.seriesImdbId,
        season: event.season,
        episode: event.episode,
        watchedAt: event.watchedAt.toISOString(),
        plays: event.plays,
        note: event.note,
      })),
      seriesProgress: seriesProgress.map((sp) => ({
        seriesImdbId: sp.seriesImdbId,
        lastSeason: sp.lastSeason,
        lastEpisode: sp.lastEpisode,
        lastWatchedAt: sp.lastWatchedAt.toISOString(),
      })),
      ratings,
    };

    return payload;
  });

  app.post<{ Body: unknown }>("/import", async (request, reply) => {
    const profileId = request.profileId!;
    const body = request.body as Partial<ExportPayload> | null;

    if (!body || typeof body !== "object" || body.version !== EXPORT_VERSION) {
      return reply.code(400).send({ error: `Expected an export payload with version ${EXPORT_VERSION}` });
    }

    // Every collection is capped independently. `MAX_BODY_SIZE_MB` bounds the
    // bytes, but minimal JSON objects pack far more rows into those bytes than
    // any real library holds, and each row is database work.
    const collections = {
      lists: Array.isArray(body.lists) ? body.lists : [],
      watchEvents: Array.isArray(body.watchEvents) ? body.watchEvents : [],
      seriesProgress: Array.isArray(body.seriesProgress) ? body.seriesProgress : [],
      ratings: Array.isArray(body.ratings) ? body.ratings : [],
    };
    const collectionLabels: Record<keyof typeof collections, string> = {
      lists: "lists",
      watchEvents: "watch events",
      seriesProgress: "series progress rows",
      ratings: "ratings",
    };
    for (const [name, rows] of Object.entries(collections)) {
      if (rows.length > MAX_IMPORT_ROWS) {
        const label = collectionLabels[name as keyof typeof collections];
        return reply.code(413).send({ error: tooManyRowsMessage(label), code: "too_many_rows" });
      }
    }
    const listItemCount = collections.lists.reduce(
      (total, list) => total + (isRecord(list) && Array.isArray(list.items) ? list.items.length : 0),
      0
    );
    if (listItemCount > MAX_IMPORT_ROWS) {
      return reply.code(413).send({ error: tooManyRowsMessage("list items"), code: "too_many_rows" });
    }

    const summary = { lists: 0, listItems: 0, watchEvents: 0, seriesProgress: 0, ratings: 0 };

    for (const list of collections.lists) {
      if (!isRecord(list) || !isString(list.name) || !Object.values(ListKind).includes(list.kind)) continue;

      const targetList =
        list.kind === ListKind.watchlist
          ? await getDefaultWatchlist(profileId)
          : await (async () => {
              const existing = await prisma.list.findFirst({
                where: { profileId, kind: ListKind.custom, name: list.name.trim() },
              });
              if (existing) return existing;
              summary.lists += 1;
              return prisma.list.create({
                data: { profileId, kind: ListKind.custom, name: list.name.trim() },
              });
            })();

      const validItems = (Array.isArray(list.items) ? list.items : []).flatMap((item) => {
        if (!isRecord(item) || !Object.values(ListItemType).includes(item.type)) return [];
        const imdbId = normalizeImdbId(item.imdbId);
        return imdbId ? [{ type: item.type, imdbId, addedAt: item.addedAt }] : [];
      });
      if (validItems.length > 0) {
        const { count } = await prisma.listItem.createMany({
          data: validItems.map((item) => ({
            listId: targetList.id,
            type: item.type,
            imdbId: item.imdbId,
            addedAt: parseDate(item.addedAt) ?? new Date(),
          })),
          skipDuplicates: true,
        });
        summary.listItems += count;
      }
    }

    const watchEventInputs: WatchEventInput[] = [];
    for (const event of collections.watchEvents) {
      if (!isRecord(event) || !Object.values(WatchEventType).includes(event.type)) continue;
      const imdbId = normalizeImdbId(event.imdbId);
      if (!imdbId) continue;
      const watchedAt = parseDate(event.watchedAt);
      if (!watchedAt) continue;

      // A present-but-unusable season/episode (fractional, or past what the
      // 32-bit column holds) drops the event rather than being nulled out —
      // nulling would silently change which episode the row refers to.
      const season = event.season == null ? null : boundedInt(event.season, 0, MAX_SEASON);
      const episode = event.episode == null ? null : boundedInt(event.episode, 0, MAX_EPISODE);
      if ((event.season != null && season === null) || (event.episode != null && episode === null)) continue;

      const seriesImdbId = normalizeImdbId(event.seriesImdbId);
      if (event.seriesImdbId != null && !seriesImdbId) continue;

      watchEventInputs.push({
        type: event.type,
        imdbId,
        seriesImdbId,
        season,
        episode,
        watchedAt,
        plays: boundedInt(event.plays, 1, MAX_PLAYS) ?? 1,
        note: isString(event.note) ? event.note : null,
      });
      summary.watchEvents += 1;
    }
    await batchUpsertWatchEvents(profileId, watchEventInputs);

    const progressInputs: { seriesImdbId: string; incoming: SeriesProgressCandidate }[] = [];
    for (const sp of collections.seriesProgress) {
      if (!isRecord(sp)) continue;
      const seriesImdbId = normalizeImdbId(sp.seriesImdbId);
      const lastSeason = boundedInt(sp.lastSeason, 0, MAX_SEASON);
      const lastEpisode = boundedInt(sp.lastEpisode, 0, MAX_EPISODE);
      if (!seriesImdbId || lastSeason === null || lastEpisode === null) continue;
      const lastWatchedAt = parseDate(sp.lastWatchedAt);
      if (!lastWatchedAt) continue;

      progressInputs.push({ seriesImdbId, incoming: { lastSeason, lastEpisode, lastWatchedAt } });
      summary.seriesProgress += 1;
    }
    await batchUpsertSeriesProgressIfNewer(profileId, progressInputs);

    const ratingInputs: RatingInput[] = [];
    for (const rating of collections.ratings) {
      if (!isRecord(rating)) continue;
      const imdbId = normalizeImdbId(rating.imdbId);
      const value = boundedNumber(rating.rating, MIN_RATING, MAX_RATING);
      if (
        !imdbId ||
        value === null ||
        (rating.type !== "movie" &&
          rating.type !== "series" &&
          rating.type !== "season" &&
          rating.type !== "episode")
      ) {
        continue;
      }
      const type = rating.type as MetadataType;
      // Season and episode ratings are located by a season, episode ratings
      // also by an episode; movie and series ratings pin both to 0, as the
      // column defaults do. A rating whose type needs one of those numbers and
      // hasn't got a usable one is dropped, not filed under season 0 — that is
      // Specials, a real season, and would land the rating on something else.
      // Same rule POST /ratings applies.
      const carriesSeason = type === "season" || type === "episode";
      if (carriesSeason && rating.season == null) continue;
      if (type === "episode" && rating.episode == null) continue;
      const season = carriesSeason ? boundedInt(rating.season, 0, MAX_SEASON) : 0;
      const episode = type === "episode" ? boundedInt(rating.episode, 0, MAX_EPISODE) : 0;
      if (season === null || episode === null) continue;

      ratingInputs.push({
        type,
        imdbId,
        season,
        episode,
        rating: value,
        ratedAt: parseDate(rating.ratedAt) ?? new Date(),
        note: isString(rating.note) ? rating.note : null,
      });
      summary.ratings += 1;
    }
    await batchUpsertRatings(profileId, ratingInputs);

    return reply.code(200).send({ status: "imported", summary });
  });

  app.post<{ Body: unknown }>("/import/csv", async (request, reply) => {
    const profileId = request.profileId!;
    const body = request.body as { csv?: unknown } | null;
    if (!body || typeof body.csv !== "string" || !body.csv.trim()) {
      return reply.code(400).send({ error: "csv is required" });
    }

    const rows = parseCsv(body.csv);
    if (rows.length === 0) {
      return reply.code(400).send({ error: "No rows found in CSV" });
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const imdbIdCol = col("imdbid");
    const typeCol = col("type");
    const seasonCol = col("season");
    const episodeCol = col("episode");
    const watchedAtCol = col("watchedat");

    if (imdbIdCol === -1 || typeCol === -1 || watchedAtCol === -1) {
      return reply.code(400).send({
        error: "CSV header must include at least: imdbId,type,watchedAt (season,episode optional)",
      });
    }

    const dataRows = rows.slice(1);
    if (dataRows.length > MAX_IMPORT_ROWS) {
      return reply.code(413).send({ error: tooManyRowsMessage("CSV rows"), code: "too_many_rows" });
    }

    let imported = 0;
    let skipped = 0;
    const watchEventInputs: WatchEventInput[] = [];

    for (const row of dataRows) {
      if (row.length === 0 || row.every((cell) => cell.trim() === "")) continue;

      const imdbId = normalizeImdbId(row[imdbIdCol]);
      const rawType = row[typeCol]?.trim().toLowerCase();
      const watchedAt = parseDate(row[watchedAtCol]?.trim());

      if (!imdbId || (rawType !== "movie" && rawType !== "episode") || !watchedAt) {
        skipped += 1;
        continue;
      }

      const rawSeason = seasonCol !== -1 ? row[seasonCol]?.trim() : "";
      const rawEpisode = episodeCol !== -1 ? row[episodeCol]?.trim() : "";
      const season = rawSeason ? boundedInt(rawSeason, 0, MAX_SEASON) : null;
      const episode = rawEpisode ? boundedInt(rawEpisode, 0, MAX_EPISODE) : null;
      if ((rawSeason && season === null) || (rawEpisode && episode === null)) {
        skipped += 1;
        continue;
      }

      const type = rawType as WatchEventType;
      const seriesImdbId = type === "episode" ? imdbId : null;

      watchEventInputs.push({ type, imdbId, seriesImdbId, season, episode, watchedAt });
      imported += 1;
    }

    await batchUpsertWatchEvents(profileId, watchEventInputs);

    return reply.code(200).send({ status: "imported", summary: { imported, skipped } });
  });
};

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 0);
}

export default exportRoutes;
