import type { FastifyBaseLogger } from "fastify";

/**
 * Client for Stremio's account API — the backend every signed-in Stremio client
 * syncs its library to.
 *
 * This API is not formally documented or versioned by Stremio; the shapes below
 * are what the official clients exchange with it. Everything here is therefore
 * defensive: unknown fields are ignored, missing fields are treated as absent
 * rather than assumed, and nothing throws on a shape we don't recognise. A
 * change on Stremio's side should degrade to "no watches found", never to a
 * crash or a wrong write.
 *
 * Note that it answers with HTTP 200 even for application-level failures (bad
 * credentials, expired authKey), carrying an `error` object in the body — so a
 * `response.ok` check alone proves nothing and every call goes through
 * `unwrap()`.
 */
const DEFAULT_STREMIO_API_BASE = "https://api.strem.io";
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The configured account-server base, minus any trailing slash.
 *
 * Refuses anything that isn't HTTPS: the very first call made against this base
 * carries the user's Stremio password, and every later one carries the authKey
 * that stands in for it. Downgrading that to plaintext is not a trade a
 * self-hoster should be able to make by typo.
 */
export const getStremioApiBase = (): string => {
  const raw = (process.env.STREMIO_API_BASE?.trim() || DEFAULT_STREMIO_API_BASE).replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new StremioApiError(`STREMIO_API_BASE is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== "https:") {
    throw new StremioApiError(`STREMIO_API_BASE must be an https:// URL (got ${parsed.protocol}//)`);
  }
  return raw;
};

/** The playback state Stremio keeps per library item. All fields are optional. */
export type StremioItemState = {
  lastWatched?: string | null;
  timeWatched?: number | null;
  timeOffset?: number | null;
  overallTimeWatched?: number | null;
  timesWatched?: number | null;
  flaggedWatched?: number | null;
  duration?: number | null;
  video_id?: string | null;
  watched?: string | null;
  season?: number | null;
  episode?: number | null;
};

export type StremioLibraryItem = {
  _id?: string | null;
  name?: string | null;
  type?: string | null;
  removed?: boolean | null;
  temp?: boolean | null;
  _ctime?: string | null;
  _mtime?: string | null;
  state?: StremioItemState | null;
};

/** `[id, mtime]` pairs — the cheap "has anything changed?" call. */
export type StremioDatastoreMetaEntry = [string, string | number];

type StremioEnvelope<T> = {
  result?: T | null;
  error?: { code?: number; message?: string } | null;
};

export class StremioApiError extends Error {
  readonly code: number | undefined;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "StremioApiError";
    this.code = code;
  }
}

/** True when the failure means "this authKey is no longer usable". */
export const isAuthError = (error: unknown): boolean =>
  error instanceof StremioApiError && (error.code === 1 || error.code === 2 || /session|authkey|unauthor/i.test(error.message));

export class StremioClient {
  constructor(private readonly baseUrl: string = getStremioApiBase()) {}

  /**
   * Exchanges email + password for a long-lived authKey. The password is used
   * for exactly this call and never persisted — see `connectStremio`.
   */
  async login(email: string, password: string, logger: FastifyBaseLogger): Promise<string> {
    const result = await this.post<{ authKey?: string | null }>(
      "/api/login",
      { type: "Login", email, password, facebook: false },
      logger
    );
    const authKey = result?.authKey;
    if (typeof authKey !== "string" || !authKey.trim()) {
      throw new StremioApiError("Stremio login succeeded but returned no authKey");
    }
    return authKey;
  }

  /** Cheap change detection: one small response listing every item id and its mtime. */
  async datastoreMeta(
    authKey: string,
    collection: string,
    logger: FastifyBaseLogger
  ): Promise<StremioDatastoreMetaEntry[]> {
    const result = await this.post<StremioDatastoreMetaEntry[]>(
      "/api/datastoreMeta",
      { authKey, collection },
      logger
    );
    if (!Array.isArray(result)) return [];
    return result.filter(
      (entry): entry is StremioDatastoreMetaEntry =>
        Array.isArray(entry) && typeof entry[0] === "string" && entry[0].length > 0
    );
  }

  /**
   * Fetches full library items. Pass `ids` to fetch only what changed; pass
   * `all: true` for the whole collection (the one-time import path).
   */
  async datastoreGet(
    authKey: string,
    collection: string,
    ids: string[] | null,
    logger: FastifyBaseLogger
  ): Promise<StremioLibraryItem[]> {
    const body: Record<string, unknown> =
      ids === null
        ? { authKey, collection, all: true }
        : { authKey, collection, all: false, ids };
    const result = await this.post<StremioLibraryItem[]>("/api/datastoreGet", body, logger);
    if (!Array.isArray(result)) return [];
    return result.filter((item): item is StremioLibraryItem => !!item && typeof item === "object");
  }

  private async post<T>(path: string, body: unknown, logger: FastifyBaseLogger): Promise<T | null> {
    // Concatenated, not resolved: `new URL("/api/login", base)` treats the
    // absolute path as root-relative and silently drops any prefix the base
    // carries, so a base of https://host/stremio would post to https://host/api/login.
    const url = new URL(`${this.baseUrl}${path}`);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Cataloggy/1.0" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new StremioApiError(
        `Stremio API request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new StremioApiError(`Stremio API request to ${path} failed (${response.status}): ${text.slice(0, 500)}`);
    }

    let envelope: StremioEnvelope<T>;
    try {
      envelope = (await response.json()) as StremioEnvelope<T>;
    } catch {
      throw new StremioApiError(`Stremio API returned a non-JSON response for ${path}`);
    }

    // The 200-with-an-error-body case. Surfacing the code matters: it is what
    // tells a failed sync apart from a revoked session that needs reconnecting.
    if (envelope?.error) {
      const { code, message } = envelope.error;
      logger.warn({ path, code, message }, "Stremio API returned an error");
      throw new StremioApiError(message?.trim() || `Stremio API error for ${path}`, code);
    }

    return envelope?.result ?? null;
  }
}
