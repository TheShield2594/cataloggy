/**
 * Shared input guards for the import endpoints (`POST /import`,
 * `/import/csv`, `/import/external`).
 *
 * Imports are the one place where a caller hands over rows that land in the
 * database more or less verbatim, so identifiers, numbers and array elements
 * are checked here rather than ad hoc at each call site. Two failure modes
 * this exists to stop:
 *
 *   - `Number.isFinite` accepts `1e20`, which overflows a Prisma 32-bit `Int`
 *     column (`season`/`episode`) and surfaces as an unhandled 500.
 *   - An array element that isn't an object (`{"lists":[null]}`) dereferences
 *     `null.name` and does the same.
 */

/** Every id Cataloggy stores is an IMDb id; the Plex webhook already parses this shape. */
const IMDB_ID_PATTERN = /^tt\d+$/;

/** Prisma `Int` columns are 32-bit — past this the database rejects the write, not the model. */
const MAX_INT32 = 2_147_483_647;

/** Generous but finite bounds for the numeric fields an import can set. */
export const MAX_SEASON = 10_000;
export const MAX_EPISODE = 100_000;
export const MAX_PLAYS = 1_000_000;
export const MIN_RATING = 0;
export const MAX_RATING = 10;

/**
 * Ceiling on rows accepted per import collection, on top of the byte ceiling
 * `MAX_BODY_SIZE_MB` already puts on the request. A 32 MB body of minimal
 * JSON objects is worth far more rows than any real library holds, and every
 * row costs database work; this keeps one request's work bounded by something
 * other than how tightly the caller can pack their payload.
 */
export const MAX_IMPORT_ROWS = 200_000;

export const tooManyRowsMessage = (collection: string, limit: number = MAX_IMPORT_ROWS) =>
  `Too many ${collection} in one import (limit ${limit.toLocaleString("en-US")}). Split the file and import it in parts.`;

/** Narrows to a plain object, so `.field` access on an array element is safe. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Returns the trimmed IMDb id, or null when it isn't one (`tt` + digits). */
export const normalizeImdbId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return IMDB_ID_PATTERN.test(trimmed) ? trimmed : null;
};

/**
 * Whole number within `[min, max]`, from either a JSON number or a CSV cell.
 * Returns null for anything else — including floats, `NaN`, `Infinity` and
 * values that would overflow a 32-bit column.
 */
export const boundedInt = (value: unknown, min: number, max: number): number | null => {
  const upper = Math.min(max, MAX_INT32);
  const lower = Math.max(min, -MAX_INT32 - 1);

  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && value.trim()) {
    parsed = Number(value);
  } else {
    return null;
  }

  if (!Number.isInteger(parsed) || parsed < lower || parsed > upper) return null;
  return parsed;
};

/** Finite (possibly fractional) number within `[min, max]`; null otherwise. */
export const boundedNumber = (value: unknown, min: number, max: number): number | null => {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && value.trim()) {
    parsed = Number(value);
  } else {
    return null;
  }

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
};
