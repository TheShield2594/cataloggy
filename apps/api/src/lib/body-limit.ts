// Fastify's stock body limit is 1 MiB, which a real library's own export blows
// past — a watch event serializes to roughly 150 bytes, so the default rejects
// the backup the app itself produced somewhere north of ~5k events. The ceiling
// still exists (an unbounded body is a memory-exhaustion vector), it's just
// sized for the data this app actually round-trips.
export const DEFAULT_MAX_BODY_SIZE_MB = 32;

// 1 MiB floor: below that the limit is tighter than Fastify's own default and
// almost certainly a typo. 1 GiB ceiling: the whole body is buffered and parsed
// in memory, so anything larger takes the process down instead of the request.
const MIN_MAX_BODY_SIZE_MB = 1;
const MAX_MAX_BODY_SIZE_MB = 1024;

export const parseMaxBodySizeMb = (raw: string | undefined): number => {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_BODY_SIZE_MB;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_MAX_BODY_SIZE_MB || parsed > MAX_MAX_BODY_SIZE_MB) {
    throw new Error(
      `MAX_BODY_SIZE_MB must be a number between ${MIN_MAX_BODY_SIZE_MB} and ${MAX_MAX_BODY_SIZE_MB} (got "${raw}").`
    );
  }
  return parsed;
};

export const mbToBytes = (mb: number): number => Math.floor(mb * 1024 * 1024);

// Fastify raises this when the body outgrows `bodyLimit`; a raw 413 with
// Fastify's stock "Payload Too Large" body tells a user restoring a backup
// nothing about what to do next, so it's rewritten in the error handler.
export const BODY_TOO_LARGE_CODE = "FST_ERR_CTP_BODY_TOO_LARGE";

export const isBodyTooLargeError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const { code, statusCode } = error as { code?: unknown; statusCode?: unknown };
  return code === BODY_TOO_LARGE_CODE || statusCode === 413;
};

export const bodyTooLargeMessage = (limitMb: number): string =>
  `Request body is larger than the ${limitMb} MB limit. Raise MAX_BODY_SIZE_MB in your environment and restart the API, or split the file into smaller imports.`;
