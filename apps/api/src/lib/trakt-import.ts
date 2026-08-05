import { ItemType, ListItemType, ListKind, MetadataType } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { TraktClient } from "../trakt.js";
import { prisma } from "./prisma.js";
import { batchUpsertRatings, type RatingInput } from "./batch-ratings.js";
import { getDefaultCollection } from "./collection.js";

/**
 * The parts of a Trakt account that aren't watch history: ratings, the
 * collection, and personal lists. Watch history has its own path
 * (pollTraktHistory) because it also runs incrementally; these only ever run
 * as a one-time import, so they live together here rather than in the route.
 *
 * Everything is keyed by IMDb id, which is what the rest of Cataloggy keys on.
 * Items Trakt knows only by its own or TMDB's id are skipped and counted, not
 * guessed at.
 */

// Trakt rates 1-10 in whole numbers, the same scale the ratings API accepts.
const MIN_RATING = 1;
const MAX_RATING = 10;

const isUsableRating = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= MIN_RATING && value <= MAX_RATING;

const ratedAtOrNow = (raw: string | undefined): Date => {
  if (!raw) return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

/**
 * The IMDb ids an import touched, so the caller can backfill metadata for
 * titles that arrived through it — a film that was only ever rated or
 * collected has no other reason to be fetched from TMDB, and would sit in the
 * UI as a bare IMDb id.
 */
export type TouchedImdbIds = { movies: string[]; series: string[] };

export type TraktRatingsImportResult = {
  movies: number;
  shows: number;
  seasons: number;
  episodes: number;
  skipped: number;
  imdbIds: TouchedImdbIds;
};

/**
 * Trakt ratings, on the same 1-10 scale Cataloggy stores.
 *
 * Season and episode ratings are keyed by the *series* IMDb id plus the season
 * (and episode) number, the convention the ratings API and every other import
 * path already use — an episode's own IMDb id would be unreachable from the
 * series pages that read them back.
 */
export const importTraktRatings = async (
  client: TraktClient,
  logger: FastifyRequest["log"],
  profileId: string
): Promise<TraktRatingsImportResult> => {
  const [ratedMovies, ratedShows, ratedSeasons, ratedEpisodes] = await Promise.all([
    client.fetchRatedMovies(logger),
    client.fetchRatedShows(logger),
    client.fetchRatedSeasons(logger),
    client.fetchRatedEpisodes(logger),
  ]);

  const inputs: RatingInput[] = [];
  const result: TraktRatingsImportResult = {
    movies: 0,
    shows: 0,
    seasons: 0,
    episodes: 0,
    skipped: 0,
    imdbIds: { movies: [], series: [] },
  };

  for (const entry of ratedMovies) {
    const imdbId = entry.movie?.ids?.imdb;
    if (!imdbId || !isUsableRating(entry.rating)) {
      result.skipped += 1;
      continue;
    }
    inputs.push({
      type: MetadataType.movie,
      imdbId,
      season: 0,
      episode: 0,
      rating: entry.rating,
      ratedAt: ratedAtOrNow(entry.rated_at),
    });
    result.imdbIds.movies.push(imdbId);
    result.movies += 1;
  }

  for (const entry of ratedShows) {
    const imdbId = entry.show?.ids?.imdb;
    if (!imdbId || !isUsableRating(entry.rating)) {
      result.skipped += 1;
      continue;
    }
    inputs.push({
      type: MetadataType.series,
      imdbId,
      season: 0,
      episode: 0,
      rating: entry.rating,
      ratedAt: ratedAtOrNow(entry.rated_at),
    });
    result.imdbIds.series.push(imdbId);
    result.shows += 1;
  }

  for (const entry of ratedSeasons) {
    const seriesImdbId = entry.show?.ids?.imdb;
    const season = entry.season?.number;
    if (!seriesImdbId || season === undefined || !isUsableRating(entry.rating)) {
      result.skipped += 1;
      continue;
    }
    inputs.push({
      type: MetadataType.season,
      imdbId: seriesImdbId,
      season,
      episode: 0,
      rating: entry.rating,
      ratedAt: ratedAtOrNow(entry.rated_at),
    });
    result.imdbIds.series.push(seriesImdbId);
    result.seasons += 1;
  }

  for (const entry of ratedEpisodes) {
    const seriesImdbId = entry.show?.ids?.imdb;
    const season = entry.episode?.season;
    const episode = entry.episode?.number;
    if (!seriesImdbId || season === undefined || episode === undefined || !isUsableRating(entry.rating)) {
      result.skipped += 1;
      continue;
    }
    inputs.push({
      type: MetadataType.episode,
      imdbId: seriesImdbId,
      season,
      episode,
      rating: entry.rating,
      ratedAt: ratedAtOrNow(entry.rated_at),
    });
    result.imdbIds.series.push(seriesImdbId);
    result.episodes += 1;
  }

  await batchUpsertRatings(profileId, inputs);

  return result;
};

/** Rows per statement — Postgres caps a statement at 65535 bind parameters. */
const CHUNK_SIZE = 1_000;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

/**
 * Files a whole list's worth of items in a handful of statements rather than
 * two per entry — a collection of a few thousand titles is a few thousand
 * sequential round trips inside one request otherwise.
 *
 * `skipDuplicates` carries the idempotence the per-row version got from
 * catching unique violations: an item another path already added (an earlier
 * run, a manual add) is passed over, and `createMany` reports how many rows it
 * actually wrote, which is exactly the "newly added" count.
 */
const addListItems = async (
  listId: string,
  entries: { type: ListItemType; imdbId: string }[]
): Promise<number> => {
  if (entries.length === 0) return 0;

  // Same title twice in one Trakt list would otherwise be two rows in the same
  // statement, which `skipDuplicates` does not deduplicate.
  const deduped = [...new Map(entries.map((e) => [`${e.type}:${e.imdbId}`, e])).values()];

  for (const batch of chunk(deduped, CHUNK_SIZE)) {
    await prisma.item.createMany({
      data: batch.map((entry) => ({
        type: entry.type === ListItemType.movie ? ItemType.movie : ItemType.series,
        imdbId: entry.imdbId,
      })),
      skipDuplicates: true,
    });
  }

  let added = 0;
  for (const batch of chunk(deduped, CHUNK_SIZE)) {
    const { count } = await prisma.listItem.createMany({
      data: batch.map((entry) => ({ listId, type: entry.type, imdbId: entry.imdbId })),
      skipDuplicates: true,
    });
    added += count;
  }

  return added;
};

export type TraktCollectionImportResult = {
  movies: number;
  shows: number;
  skipped: number;
  imdbIds: TouchedImdbIds;
};

/** Trakt's collection — what you own — into Cataloggy's Collection list. */
export const importTraktCollection = async (
  client: TraktClient,
  logger: FastifyRequest["log"],
  profileId: string
): Promise<TraktCollectionImportResult> => {
  const [collectedMovies, collectedShows] = await Promise.all([
    client.fetchCollectionMovies(logger),
    client.fetchCollectionShows(logger),
  ]);

  const collection = await getDefaultCollection(profileId);
  const result: TraktCollectionImportResult = {
    movies: 0,
    shows: 0,
    skipped: 0,
    imdbIds: { movies: [], series: [] },
  };

  for (const entry of collectedMovies) {
    const imdbId = entry.movie?.ids?.imdb;
    if (!imdbId) {
      result.skipped += 1;
      continue;
    }
    result.imdbIds.movies.push(imdbId);
  }

  for (const entry of collectedShows) {
    const imdbId = entry.show?.ids?.imdb;
    if (!imdbId) {
      result.skipped += 1;
      continue;
    }
    result.imdbIds.series.push(imdbId);
  }

  result.movies = await addListItems(
    collection.id,
    result.imdbIds.movies.map((imdbId) => ({ type: ListItemType.movie, imdbId }))
  );
  result.shows = await addListItems(
    collection.id,
    result.imdbIds.series.map((imdbId) => ({ type: ListItemType.series, imdbId }))
  );

  return result;
};

export type TraktListsImportResult = {
  lists: number;
  items: number;
  skipped: number;
  imdbIds: TouchedImdbIds;
};

/**
 * Personal Trakt lists, each becoming a Cataloggy custom list of the same
 * name. A list that already exists here under that name is filled rather than
 * duplicated, so re-running the import doesn't leave two of everything.
 */
export const importTraktPersonalLists = async (
  client: TraktClient,
  logger: FastifyRequest["log"],
  profileId: string
): Promise<TraktListsImportResult> => {
  const personalLists = await client.fetchPersonalLists(logger);
  const result: TraktListsImportResult = { lists: 0, items: 0, skipped: 0, imdbIds: { movies: [], series: [] } };

  for (const traktList of personalLists) {
    const traktListId = traktList.ids?.trakt;
    const name = traktList.name?.trim();
    if (traktListId === undefined || !name) {
      result.skipped += 1;
      continue;
    }

    let items;
    try {
      items = await client.fetchPersonalListItems(traktListId, logger);
    } catch (error) {
      // One unreadable list (deleted mid-import, or a Trakt-side error) should
      // not cost the user every other list in the same import.
      logger.warn({ error, list: name }, "Trakt list items could not be fetched — skipping that list");
      result.skipped += 1;
      continue;
    }

    const existing = await prisma.list.findFirst({
      where: { profileId, kind: ListKind.custom, name },
      orderBy: { createdAt: "asc" },
    });
    const list =
      existing ?? (await prisma.list.create({ data: { profileId, kind: ListKind.custom, name } }));
    if (!existing) result.lists += 1;

    const entries: { type: ListItemType; imdbId: string }[] = [];
    for (const item of items) {
      const imdbId = item.movie?.ids?.imdb ?? item.show?.ids?.imdb;
      const type = item.movie ? ListItemType.movie : item.show ? ListItemType.series : null;
      if (!imdbId || !type) {
        result.skipped += 1;
        continue;
      }
      if (type === ListItemType.movie) result.imdbIds.movies.push(imdbId);
      else result.imdbIds.series.push(imdbId);
      entries.push({ type, imdbId });
    }

    result.items += await addListItems(list.id, entries);
  }

  return result;
};
