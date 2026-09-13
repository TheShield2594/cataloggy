// The one integration that points outward.
//
// Every other service Cataloggy talks to answers "what have I watched" or
// "what is this thing". This one answers the question that comes right after
// adding something to the watchlist on a self-hosted stack: get it onto the
// server. Jellyseerr (and Overseerr, whose API this is — the two are
// compatible here) is the target rather than Sonarr and Radarr directly
// because it is one URL and one API key instead of two of each plus a root
// folder and a quality profile, and because it already knows about whichever
// Sonarr/Radarr instances sit behind it.
//
// Three properties this deliberately keeps:
//
//   * **Off unless configured.** No URL, no requests. The feature moves the app
//     a step toward "manages your library", which is not what everyone wants
//     from it.
//   * **A failure never fails the list add.** Nothing here throws into the
//     route; a failed request is recorded against the `jellyseerr-request` job
//     so it shows up in Settings → Sync Status rather than as an error on a
//     watchlist button that did in fact work.
//   * **Removals are opt-in and only ever cancel a request nobody acted on
//     yet.** Un-listing something should not delete a download — the same
//     caution `TRAKT_WATCHLIST_MIRROR_DELETES` applies to the watchlist itself,
//     for a case that is less recoverable.
//
// SECURITY: the URL is user-supplied and requested by the server, so it gets
// the same treatment as the notification channels and the AI provider —
// validated on save, re-resolved immediately before every request (DNS can
// change after it is stored), and redirects refused rather than followed. A
// LAN or loopback target is the expected configuration here, so the policy is
// the permissive one; see `lib/ssrf.ts`.

import { MetadataType } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "./prisma.js";
import { fetchWithPolicy } from "./http.js";
import { recordJobFailure, recordJobSuccess } from "./job-status.js";
import { OUTBOUND_FAILURE_MESSAGE } from "./outbound-test.js";
import type { OutboundFailure } from "./outbound-test.js";
import { deleteSecretKv, readSecretKv, writeSecretKv } from "./secret-store.js";
import { resolveNotificationUrl, validateNotificationUrl } from "./ssrf.js";
import { getTmdb } from "./tmdb-client.js";

export const JELLYSEERR_CONFIG_KEY = "jellyseerr:config";

export type JellyseerrConfig = {
  /** Base URL of the Jellyseerr/Overseerr server, without the `/api/v1` suffix. */
  url: string;
  apiKey: string;
  /** Whether adding to the watchlist requests the title. Off leaves the connection idle. */
  requestOnAdd: boolean;
  /** Whether removing from the watchlist cancels a request nobody has approved yet. */
  cancelOnRemove: boolean;
};

/** What Settings may see: everything except the credential. */
export type PublicJellyseerrConfig = Omit<JellyseerrConfig, "apiKey"> & { hasApiKey: boolean };

export const publicJellyseerrConfig = (config: JellyseerrConfig): PublicJellyseerrConfig => ({
  url: config.url,
  requestOnAdd: config.requestOnAdd,
  cancelOnRemove: config.cancelOnRemove,
  hasApiKey: !!config.apiKey,
});

/**
 * A failure with both halves of the story, like `ChannelSendError`: `message`
 * names the status or socket error for the log, and `publicMessage` is the
 * collapsed verdict the test endpoint is allowed to hand back. See
 * `lib/outbound-test.ts` for why the detail does not leave the server.
 */
export class JellyseerrError extends Error {
  readonly outcome: OutboundFailure;
  readonly publicMessage: string;
  /**
   * The status Jellyseerr answered with, or null when nothing answered.
   * Carried so a caller can branch on it — 409 means "already requested" —
   * rather than reading it back out of the message, which also carries socket
   * error text a peer is free to put anything in.
   */
  readonly status: number | null;

  constructor(
    outcome: OutboundFailure,
    message: string,
    options: { cause?: unknown; publicMessage?: string; status?: number } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "JellyseerrError";
    this.outcome = outcome;
    this.status = options.status ?? null;
    this.publicMessage = options.publicMessage ?? OUTBOUND_FAILURE_MESSAGE[outcome];
  }
}

// The whole config is stored as one encrypted blob rather than just the key,
// for the reason `ai.ts` gives about its own: the key is the credential, but
// the address of a service on someone's LAN is worth no more exposure than it
// needs either, and one blob means there is no half-encrypted row to reason
// about.
export const getJellyseerrConfig = async (): Promise<JellyseerrConfig | null> => {
  const stored = await readSecretKv(JELLYSEERR_CONFIG_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<JellyseerrConfig>;
    if (typeof parsed.url !== "string" || typeof parsed.apiKey !== "string") return null;
    return {
      url: parsed.url,
      apiKey: parsed.apiKey,
      // Both flags default to their safe reading for a row written before they
      // existed: request adds (the point of connecting at all), never cancel.
      requestOnAdd: parsed.requestOnAdd !== false,
      cancelOnRemove: parsed.cancelOnRemove === true,
    };
  } catch {
    return null;
  }
};

export const saveJellyseerrConfig = (config: JellyseerrConfig): Promise<void> =>
  writeSecretKv(JELLYSEERR_CONFIG_KEY, JSON.stringify(config));

export const clearJellyseerrConfig = (): Promise<void> => deleteSecretKv(JELLYSEERR_CONFIG_KEY);

/**
 * Trailing slashes off, by scan rather than by `replace(/\/+$/, "")`.
 *
 * The regex is the polynomial-backtracking shape CodeQL flags on a value that
 * came from outside: a base URL ending in tens of thousands of slashes makes
 * the engine retry from every one of them. Nothing here is worth a stall, and
 * the stored URL is a string this process accepted once and then re-reads on
 * every watchlist add.
 */
const stripTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
};

/** The server URL with its path prefix kept, so an instance behind a reverse proxy works. */
const apiUrl = (base: string, path: string): string => `${stripTrailingSlashes(base)}/api/v1${path}`;

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * One call against the Jellyseerr API, with the SSRF and redirect policy this
 * module promises. Returns the parsed body; throws `JellyseerrError` for
 * anything that isn't a 2xx.
 */
const call = async <T>(
  config: JellyseerrConfig,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  // Resolved per request rather than trusting the save-time check: the config
  // may have been stored months ago, and the name could point somewhere else
  // now.
  //
  // What comes back is what gets requested. Handing `fetch` the string instead
  // would parse it a second time, and a request is only as safe as the value
  // that was actually checked — two parsers disagreeing about where a URL
  // points is the shape of the bypass this whole path exists to prevent.
  const target = await resolveNotificationUrl(apiUrl(config.url, path));
  if (!target) {
    throw new JellyseerrError("blocked", `Jellyseerr URL resolves to an address that is not an allowed outbound target`);
  }

  let response: Response;
  try {
    response = await fetchWithPolicy(
      target,
      {
        ...init,
        headers: {
          Accept: "application/json",
          "X-Api-Key": config.apiKey,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        // An allowed host must not be able to bounce this somewhere the
        // validator would have rejected.
        redirect: "error",
      },
      { timeoutMs: REQUEST_TIMEOUT_MS, retries: 0 }
    );
  } catch (cause) {
    // The socket error names the address and separates a closed port from a
    // filtered one, so it stays in the log rather than going back to a caller.
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new JellyseerrError("unreachable", `Jellyseerr request to ${path} failed: ${detail}`, { cause });
  }

  if (response.status === 401 || response.status === 403) {
    throw new JellyseerrError("rejected", `Jellyseerr rejected the API key (HTTP ${response.status})`, {
      status: response.status,
      // Safe to name: it describes this install's own configuration rather
      // than anything learned from the target.
      publicMessage: "Jellyseerr rejected that API key.",
    });
  }

  if (!response.ok) {
    throw new JellyseerrError("rejected", `Jellyseerr answered HTTP ${response.status} for ${path}`, {
      status: response.status,
    });
  }

  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new JellyseerrError("rejected", `Jellyseerr answered ${path} with a body that is not JSON`, { cause });
  }
};

export type JellyseerrTestResult = { version: string | null; applicationTitle: string | null };

/**
 * Proves the URL and the key together: `/status` says something Jellyseerr-
 * shaped is listening, and `/settings/main` is an admin-only route, so a key
 * that reads it is a key that can file requests. A URL that merely answers 200
 * — a reverse proxy's login page, the wrong container — fails the first.
 */
export const testJellyseerr = async (config: JellyseerrConfig): Promise<JellyseerrTestResult> => {
  const status = await call<{ version?: unknown }>(config, "/status");
  if (typeof status?.version !== "string") {
    throw new JellyseerrError("rejected", "That URL answered, but not like a Jellyseerr server", {
      publicMessage: "That address answered, but it does not look like a Jellyseerr or Overseerr server.",
    });
  }

  const settings = await call<{ applicationTitle?: unknown }>(config, "/settings/main");

  return {
    version: status.version,
    applicationTitle: typeof settings?.applicationTitle === "string" ? settings.applicationTitle : null,
  };
};

export type WatchlistRequestItem = { type: "movie" | "series"; imdbId: string };

/**
 * The TMDB id Jellyseerr needs, which is not the id the watchlist is keyed on.
 * The metadata row usually has it already — the same background sync the add
 * route kicks off fills it — and the TMDB lookup is the fallback for a title
 * added before that landed.
 */
const resolveTmdbId = async (item: WatchlistRequestItem): Promise<number | null> => {
  const type = item.type === "movie" ? MetadataType.movie : MetadataType.series;

  const row = await prisma.metadata.findUnique({
    where: { imdbId_type: { imdbId: item.imdbId, type } },
    select: { tmdbId: true },
  });
  if (row?.tmdbId) return row.tmdbId;

  const tmdb = await getTmdb();
  const payload = await tmdb.findByImdbId(type, item.imdbId);
  return payload?.tmdbId ?? null;
};

/** Overseerr's request statuses. Only the first is ours to withdraw. */
const REQUEST_STATUS_PENDING = 1;

type JellyseerrRequest = {
  id: number;
  status: number;
  media?: { tmdbId?: number | null; mediaType?: string | null } | null;
};

// Pending requests are paged through rather than filtered server-side by
// media: Overseerr's request list has no by-tmdbId filter, so finding one
// means walking the pending page. Bounded, because "cancel the thing I just
// un-listed" is not worth an unbounded walk of a queue someone has let grow to
// thousands.
const CANCEL_SCAN_PAGE_SIZE = 50;
const CANCEL_SCAN_MAX_PAGES = 5;

const findPendingRequest = async (
  config: JellyseerrConfig,
  tmdbId: number,
  mediaType: "movie" | "tv"
): Promise<JellyseerrRequest | null> => {
  for (let page = 0; page < CANCEL_SCAN_MAX_PAGES; page++) {
    const body = await call<{ results?: JellyseerrRequest[] }>(
      config,
      `/request?take=${CANCEL_SCAN_PAGE_SIZE}&skip=${page * CANCEL_SCAN_PAGE_SIZE}&filter=pending&sort=added`
    );
    const results = body?.results ?? [];

    const match = results.find(
      (entry) =>
        entry.status === REQUEST_STATUS_PENDING &&
        entry.media?.tmdbId === tmdbId &&
        entry.media?.mediaType === mediaType
    );
    if (match) return match;

    if (results.length < CANCEL_SCAN_PAGE_SIZE) return null;
  }

  return null;
};

/**
 * Files the request. Returns what happened so the caller can log it; throws
 * `JellyseerrError` on a failure worth recording.
 *
 * An already-requested title is a success, not a failure: Jellyseerr answers
 * 409 for it, and re-adding something that is already on its way is exactly
 * the case that would otherwise fill Sync Status with noise.
 */
const createRequest = async (
  config: JellyseerrConfig,
  tmdbId: number,
  mediaType: "movie" | "tv"
): Promise<"requested" | "already-requested"> => {
  try {
    await call(config, "/request", {
      method: "POST",
      body: JSON.stringify({
        mediaType,
        mediaId: tmdbId,
        // A series is requested whole. Jellyseerr requires the field for `tv`
        // and rejects the request without it; picking seasons is a decision
        // this integration has no way to ask about.
        ...(mediaType === "tv" ? { seasons: "all" } : {}),
      }),
    });
    return "requested";
  } catch (error) {
    if (error instanceof JellyseerrError && error.status === 409) return "already-requested";
    throw error;
  }
};

const mediaTypeFor = (type: WatchlistRequestItem["type"]): "movie" | "tv" => (type === "movie" ? "movie" : "tv");

/**
 * Mirrors a watchlist change to Jellyseerr. Best-effort in the strong sense:
 * it never throws — including from the config read, so a caller may leave the
 * promise unawaited — and a failure is recorded against the
 * `jellyseerr-request` job so Settings → Sync Status can show it.
 *
 * Returns what it did, which is what the tests assert on and what the log line
 * says; callers have no decision to make from it.
 */
export const pushWatchlistRequest = async (
  action: "add" | "remove",
  item: WatchlistRequestItem,
  logger: FastifyBaseLogger
): Promise<"skipped" | "requested" | "already-requested" | "cancelled" | "not-found" | "failed"> => {
  try {
    const config = await getJellyseerrConfig();
    if (!config?.url || !config.apiKey) return "skipped";
    if (action === "add" ? !config.requestOnAdd : !config.cancelOnRemove) return "skipped";

    const tmdbId = await resolveTmdbId(item);
    if (tmdbId === null) {
      // Not a failure of the integration: TMDB has no entry against this IMDb
      // id, so there is nothing Jellyseerr could be asked for. Logged, because
      // a watchlist full of them is worth noticing.
      logger.info({ item }, "No TMDB id for watchlist item; nothing to send to Jellyseerr");
      return "not-found";
    }

    const mediaType = mediaTypeFor(item.type);

    if (action === "add") {
      const outcome = await createRequest(config, tmdbId, mediaType);
      await recordJobSuccess("jellyseerr-request");
      logger.info({ item, tmdbId, outcome }, "Jellyseerr request");
      return outcome;
    }

    // Only a request nobody has acted on yet. Once Jellyseerr has approved it,
    // the download exists (or is on its way) in Sonarr/Radarr, and un-listing
    // a title is not a decision to delete it.
    const pending = await findPendingRequest(config, tmdbId, mediaType);
    if (!pending) return "not-found";

    await call(config, `/request/${pending.id}`, { method: "DELETE" });
    await recordJobSuccess("jellyseerr-request");
    logger.info({ item, tmdbId, requestId: pending.id }, "Cancelled pending Jellyseerr request");
    return "cancelled";
  } catch (error) {
    // The add itself already succeeded, so this is reported where a background
    // failure is reported and nowhere else.
    logger.warn({ err: error, action, item }, "Jellyseerr watchlist push failed");
    await recordJobFailure("jellyseerr-request", error).catch(() => {
      // Recording the failure failing is not worth a second failure path.
    });
    return "failed";
  }
};

/**
 * Whether `raw` is a URL this install will send requests to, as a parsed URL.
 * Same policy as a notification channel: a Jellyseerr on the LAN or on
 * localhost is the expected configuration, so only the never-legitimate
 * targets are refused.
 */
export const validateJellyseerrUrl = (raw: string): URL | null => validateNotificationUrl(raw);

/** `validateJellyseerrUrl` plus a DNS check, for save-time validation. */
export const resolveJellyseerrUrl = (raw: string): Promise<URL | null> => resolveNotificationUrl(raw);
