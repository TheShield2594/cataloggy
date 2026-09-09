import type { FastifyReply } from "fastify";

/**
 * Adds field names to `Vary` without discarding what another hook already put
 * there.
 *
 * `reply.header` *replaces* for every header except `Set-Cookie`, so two hooks
 * that each set `Vary` leave only whichever ran last. That is what happened
 * between the CORS hook (`Vary: Origin`, set in `onRequest`) and the
 * HTTP-caching hook (`Vary: Authorization, X-Profile-Id`, set in `onSend`):
 * every cacheable response shipped without `Vary: Origin`, so an intermediary
 * that stored a response carrying one origin's `Access-Control-Allow-Origin`
 * could hand it to a request from another.
 *
 * Comparison is case-insensitive (field names are), and the existing order and
 * spelling are kept so a value is only ever extended, never rewritten.
 */
export const appendVary = (reply: FastifyReply, ...fields: string[]): void => {
  const existing = splitFields(reply.getHeader("Vary"));

  // `Vary: *` already says the response varies on more than headers can
  // express; narrowing it to a list would make it cacheable again.
  if (existing.includes("*")) return;

  const seen = new Set(existing.map((field) => field.toLowerCase()));
  const merged = [...existing];

  for (const field of splitFields(fields)) {
    if (seen.has(field.toLowerCase())) continue;
    seen.add(field.toLowerCase());
    merged.push(field);
  }

  if (merged.length > 0) reply.header("Vary", merged.join(", "));
};

// A header Fastify hands back can be a string, a repeated header's array, or a
// number; each string can itself be a comma-separated list.
const splitFields = (value: number | string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : [value])
    .filter((entry): entry is string => typeof entry === "string")
    .flatMap((entry) => entry.split(","))
    .map((field) => field.trim())
    .filter(Boolean);
