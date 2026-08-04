import type { MetadataType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { mapWithConcurrency } from "./concurrency.js";

const UPDATE_CONCURRENCY = 10;

/**
 * Rows per database round trip. Postgres caps a statement at 65535 bind
 * parameters, and each rating carries seven columns, so a single `createMany`
 * over a whole import would blow past that long before it ran out of memory.
 */
const CHUNK_SIZE = 1_000;

export type RatingInput = {
  type: MetadataType;
  imdbId: string;
  /** 0 for anything that isn't an episode rating — matches the column default. */
  season: number;
  episode: number;
  rating: number;
  ratedAt: Date;
  note?: string | null;
};

const ratingKey = (input: { type: string; imdbId: string; season: number; episode: number }) =>
  `${input.type}:${input.imdbId}:${input.season}:${input.episode}`;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

/**
 * Bulk equivalent of the per-row `prisma.rating.upsert` the import paths used
 * to run. An import of a few thousand ratings meant a few thousand sequential
 * round trips inside one request; this reads the rows the batch could collide
 * with in a handful of queries, resolves creates and updates in memory (later
 * rows in the batch win, as they did when each was upserted in order), then
 * flushes with chunked `createMany`s and a bounded set of concurrent updates.
 */
export async function batchUpsertRatings(profileId: string, inputs: RatingInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  // Collapse duplicates within the batch first, so two rows for the same title
  // don't race each other as separate writes.
  const deduped = new Map<string, RatingInput>();
  for (const input of inputs) deduped.set(ratingKey(input), input);

  const imdbIds = [...new Set([...deduped.values()].map((input) => input.imdbId))];

  const existing = new Set<string>();
  for (const ids of chunk(imdbIds, CHUNK_SIZE)) {
    const rows = await prisma.rating.findMany({
      where: { profileId, imdbId: { in: ids } },
      select: { type: true, imdbId: true, season: true, episode: true },
    });
    for (const row of rows) existing.add(ratingKey(row));
  }

  const creates: RatingInput[] = [];
  const updates: RatingInput[] = [];
  for (const [key, input] of deduped) {
    if (existing.has(key)) updates.push(input);
    else creates.push(input);
  }

  for (const batch of chunk(creates, CHUNK_SIZE)) {
    await prisma.rating.createMany({
      data: batch.map((input) => ({ profileId, ...input, note: input.note ?? null })),
      // A concurrent write (another import, a rating set from the UI) can land
      // between the read above and this insert; skipping is closer to the
      // upsert this replaces than failing the whole import.
      skipDuplicates: true,
    });
  }

  if (updates.length > 0) {
    // `updateMany` rather than `update` so a row deleted between the read and
    // the write is a no-op instead of a P2025 that fails the whole import.
    await mapWithConcurrency(updates, UPDATE_CONCURRENCY, (input) =>
      prisma.rating.updateMany({
        where: {
          profileId,
          type: input.type,
          imdbId: input.imdbId,
          season: input.season,
          episode: input.episode,
        },
        data: { rating: input.rating, ratedAt: input.ratedAt, note: input.note ?? null },
      })
    );
  }

  return deduped.size;
}
