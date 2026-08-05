import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";

// Every response this file touches is private to one profile of one install, so
// nothing here is ever `public` — a shared proxy that cached one profile's
// watchlist and served it to another would be a data leak, not a speed-up.
//
// Two tiers, split on whether the user can change the answer:
//
// - `metadata` covers TMDB-derived facts about a title. A film's cast does not
//   change while you are looking at it, and no action in the app can change it,
//   so the browser may answer from its own cache without asking. This is what
//   makes reopening a detail panel you looked at five minutes ago cost nothing.
//
// - `revalidate` covers everything the user owns — watchlist, lists, history,
//   stats, progress, calendar. A `max-age` here would be a correctness bug: the
//   app can invalidate its service-worker cache after a mutation but has no way
//   to reach into the browser's HTTP cache, so a stale entry would outlive the
//   change that should have replaced it. `no-cache` keeps the round trip and
//   spends an ETag instead: unchanged data comes back as a bodyless 304, which
//   on a long list is most of the bytes and all of the JSON parsing.
const METADATA_MAX_AGE_SEC = 5 * 60;
const METADATA_STALE_WHILE_REVALIDATE_SEC = 24 * 60 * 60;

const METADATA_PATH_RE = /^\/(meta\/|recommendations(\/|$|\?)|trending|popular|streaming(\/|$|\?)|anime)/;

const REVALIDATE_PATH_RE = new RegExp(
  "^/(" +
    [
      "watchlist",
      "continue",
      "recent",
      "series/progress",
      "watch/history",
      "watch/stats(/detailed)?",
      "lists(/.*)?",
      "calendar",
      "collection",
      "games(/.*)?",
      "tags",
    ].join("|") +
    ")$"
);

export type CacheTier = "metadata" | "revalidate";

const pathOf = (url: string): string => {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
};

export function cacheTierFor(url: string): CacheTier | null {
  const path = pathOf(url);
  if (METADATA_PATH_RE.test(path)) return "metadata";
  if (REVALIDATE_PATH_RE.test(path)) return "revalidate";
  return null;
}

export function weakEtag(payload: string): string {
  return `W/"${createHash("sha1").update(payload).digest("base64url")}"`;
}

/**
 * RFC 9110 §13.1.2: `If-None-Match` is a comma-separated list, `*` matches
 * anything, and comparison is weak — so `W/"x"` and `"x"` are the same entity.
 */
export function ifNoneMatchSatisfied(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const normalize = (value: string) => value.trim().replace(/^W\//, "");
  const target = normalize(etag);
  return header
    .split(",")
    .some((candidate) => candidate.trim() === "*" || normalize(candidate) === target);
}

/**
 * Registers conditional-request handling for read-only GET routes.
 *
 * Must be registered before `@fastify/compress`, so the ETag is computed over
 * the JSON rather than over whichever encoding the client happened to negotiate
 * — otherwise the same data would carry a different tag per client, and no
 * revalidation would ever hit.
 */
export function registerHttpCaching(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "GET") return payload;
    if (reply.statusCode !== 200) return payload;
    // Streams and buffers are exports and file downloads, not the JSON this is
    // for, and hashing them would mean buffering the whole thing in memory.
    if (typeof payload !== "string") return payload;

    const tier = cacheTierFor(request.url);
    if (!tier) return payload;

    // The response depends on who is asking. Without this a browser (or an
    // intermediary) could serve one profile's cached entry for another's
    // request to the same URL.
    reply.header("Vary", "Authorization, X-Profile-Id");

    reply.header(
      "Cache-Control",
      tier === "metadata"
        ? `private, max-age=${METADATA_MAX_AGE_SEC}, stale-while-revalidate=${METADATA_STALE_WHILE_REVALIDATE_SEC}`
        : "private, no-cache"
    );

    const etag = weakEtag(payload);
    reply.header("ETag", etag);

    if (ifNoneMatchSatisfied(request.headers["if-none-match"], etag)) {
      reply.code(304);
      // A 304 carries no body, and Fastify would otherwise keep the
      // Content-Length of the payload we are dropping.
      reply.removeHeader("content-length");
      return null;
    }

    return payload;
  });
}
