/**
 * The one place this client talks to the network.
 *
 * Every domain module describes its calls in terms of `request`, so the
 * timeout, the auth headers, the offline-write handling, the cache
 * invalidation a mutation triggers and the error shaping all happen once
 * rather than 102 times.
 */

import { ApiContractError } from "@cataloggy/shared/contracts";
import { captureException } from "../sentry";
import {
  currentIdentity,
  invalidatedCachePrefixes,
  notifyServiceWorkerToInvalidateApiCache,
  runtimeConfig,
} from "./runtime";
import { invalidate as invalidateCachePrefix, invalidateAll as invalidateMemoryCache } from "../utils/dataCache";

export class ApiError extends Error {
  /**
   * `code` is the API's machine-readable reason, when the response carried one
   * — `igdb_not_configured`, `too_many_rows`, `profile_not_active`. It is what
   * lets a caller tell apart two failures that share a status: a 503 because an
   * optional integration was never set up is a thing to offer setup for, while
   * any other 503 is a thing to retry. Branch on `code` before `message`, which
   * is prose meant for a human and free to change.
   */
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * A write the service worker is holding until the connection is back.
 *
 * Thrown rather than returned because there is nothing truthful to return: the
 * server has not seen this write, so it has no id, no play count and no view of
 * how it merged with what was already there. A caller that knows the write is
 * worth showing anyway — a watch is a fact about the past, and stays true —
 * catches this and keeps its optimistic state; one that doesn't shows the
 * message, which says what actually happened rather than "this needs a
 * connection".
 *
 * Only the worker can raise it: see the 202 it answers with in sw.js.
 */
export class OfflineWriteQueuedError extends Error {
  constructor() {
    super("Saved offline — Cataloggy will send this as soon as you're back online.");
    this.name = "OfflineWriteQueuedError";
  }
}

const authHeaders = (hasBody: boolean) => {
  const token = runtimeConfig.getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }
  const profileId = runtimeConfig.getProfileId();
  if (profileId) {
    headers["x-profile-id"] = profileId;
  }
  const profileToken = runtimeConfig.getProfileToken();
  if (profileToken) {
    headers["x-profile-token"] = profileToken;
  }
  return headers;
};


declare global {
  interface Window {
    /** Set by public/preload-dashboard.js — in-flight responses started during HTML parse. */
    __CATALOGGY_PRELOAD__?: Record<string, Promise<Response | null>> | undefined;
  }
}

/**
 * Claims the response that `preload-dashboard.js` started for `path`, if there
 * is one. Each is claimed at most once and removed as it is taken, so a later
 * refresh of the same endpoint goes to the network as normal — this stands in
 * for the very first request of a session, not for the cache.
 */
function claimPreloadedResponse(path: string): Promise<Response | null> | null {
  const preloaded = window.__CATALOGGY_PRELOAD__;
  if (!preloaded) return null;
  const pending = preloaded[path];
  if (!pending) return null;
  delete preloaded[path];
  return pending;
}

/**
 * `request`'s own options, rather than `RequestInit` straight: every caller
 * that takes an `AbortSignal` takes an optional one and forwards it as
 * `{ signal }`, so the type has to say that a present-but-undefined signal
 * means the same as no signal — which is what `fetch` does with it, and what
 * `RequestInit`'s own `signal?: AbortSignal | null` stops saying under
 * `exactOptionalPropertyTypes`.
 */
type RequestOptions = Omit<RequestInit, "signal"> & {
  signal?: AbortSignal | null | undefined;
  timeoutMs?: number | undefined;
};

async function performRequest<T>(path: string, init?: RequestOptions): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 30000;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (init?.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener("abort", onExternalAbort);
  }

  let response: Response;
  try {
    // A GET the preload script already started: adopt it rather than issue a
    // second one. Only for plain GETs — anything with a body, custom headers or
    // a caller-supplied signal is not the request that was preloaded.
    const claimed =
      method === "GET" && !init?.body && !init?.headers && !init?.signal
        ? claimPreloadedResponse(path)
        : null;

    // An adopted preload is a promise nothing else governs: the timeout above
    // and any caller abort apply to `fetch`, not to a request the page head
    // started. Racing it against the same signal keeps both behaving alike, so a
    // preload that never settles cannot hang the caller forever.
    const preloaded = claimed
      ? await Promise.race([
          claimed,
          new Promise<never>((_, reject) => {
            const abort = () =>
              reject(new DOMException("The operation was aborted.", "AbortError"));
            if (controller.signal.aborted) abort();
            else controller.signal.addEventListener("abort", abort, { once: true });
          }),
        ])
      : null;

    response =
      preloaded ??
      (await fetch(`${runtimeConfig.getApiBase()}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...authHeaders(init?.body != null),
          ...(init?.headers ?? {})
        }
      }));
  } catch (err) {
    if (init?.signal?.aborted) {
      // The caller cancelled this request on purpose (e.g. a newer request
      // superseded it) — rethrow the original AbortError as-is so callers
      // can detect and silently ignore intentional cancellations instead
      // of surfacing a misleading error.
      throw err;
    }
    if (timedOut) {
      throw new Error(`Request timed out – is the API server running at ${runtimeConfig.getApiBase()}?`, { cause: err });
    }
    // The device has no network at all, so the server-misconfiguration message
    // below would send the user to debug an install that is working fine. Only
    // `onLine === false` is trustworthy here: `true` covers "on Wi-Fi that
    // can't see the API", which really is the case that message is for.
    if (navigator.onLine === false) {
      throw new Error("You're offline – this needs a connection. Try again once you're back online.", { cause: err });
    }
    throw new Error(`Network error – cannot reach ${runtimeConfig.getApiBase()}. Check that the API server is running and the URL is correct.`, { cause: err });
  } finally {
    // Clear stale cache entries for attempted mutations even if the request
    // itself failed or timed out below — a half-failed write can still have
    // landed server-side, and we'd rather over-invalidate than serve stale data.
    clearTimeout(timeoutId);
    init?.signal?.removeEventListener("abort", onExternalAbort);
    if (method !== "GET") {
      // Same over-invalidate-rather-than-serve-stale rule the service-worker
      // cache follows, applied to the in-memory one: a write can touch rows on
      // pages other than the one that issued it, and the cost of being wrong
      // here is showing the user data they just changed. What it does not have
      // to do is take pages the write cannot reach down with it — see
      // `invalidatedCachePrefixes`.
      const prefixes = invalidatedCachePrefixes(path);
      if (prefixes === null) invalidateMemoryCache();
      else for (const prefix of prefixes) invalidateCachePrefix(prefix);
      await notifyServiceWorkerToInvalidateApiCache();
    }
  }

  // Not the API answering: the service worker took this write when the network
  // wasn't there and will send it later. A 202 the API itself could return is
  // not confusable with this one — the header is synthesised in sw.js and no
  // response off the wire carries it.
  if (response.status === 202 && response.headers.get("x-cataloggy-queued") === "1") {
    throw new OfflineWriteQueuedError();
  }

  if (!response.ok) {
    const body = await response.text();
    // API errors are shaped as JSON: { "error": "human-readable message" }.
    // Fall back to the raw body if it isn't (or isn't valid JSON) so nothing
    // is ever silently swallowed.
    let message = body;
    let errorCode: string | undefined;
    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: unknown | undefined; code?: unknown | undefined };
        if (typeof parsed.error === "string" && parsed.error.trim()) {
          message = parsed.error;
        }
        if (typeof parsed.code === "string") {
          errorCode = parsed.code;
        }
      } catch {
        // not JSON — use the raw body as-is
      }
    }
    // A PIN-protected profile's access token is missing or expired. Drop the
    // stale profile selection and prompt the user to re-verify, rather than
    // leaving every page stuck on a 401.
    if (response.status === 401 && errorCode === "profile_verification_required") {
      runtimeConfig.clearProfileId();
      window.dispatchEvent(new Event("cataloggy:profile-locked"));
    }
    // A 401 with a WWW-Authenticate header (RFC 6750) comes from the bearer-token
    // auth middleware itself, meaning the stored token is missing/invalid/rotated —
    // as opposed to a route-level 401 like an incorrect profile PIN. Clear it and
    // tell the app to fall back to the setup wizard instead of leaving every page
    // stuck on a generic "Unable to connect" error for the rest of the session.
    if (response.status === 401 && response.headers.get("www-authenticate")) {
      runtimeConfig.setToken("");
      window.dispatchEvent(new Event("cataloggy:unauthorized"));
    }
    throw new ApiError(message || `Request failed: ${response.status}`, response.status, errorCode);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    throw new Error(
      `Expected JSON from API but received "${contentType}". ` +
      `Make sure ${runtimeConfig.getApiBase()} points to the Cataloggy API server, not the web UI.`
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Runs a response through its contract parser.
 *
 * The message a parser raises names a field path — `calendar[3].airDate must be
 * a YYYY-MM-DD date` — which is what a maintainer needs and not what anyone
 * should read off a page, so it becomes the `cause` and Sentry's payload, and
 * the caller gets a sentence that says what actually happened: the two halves
 * of a staggered upgrade disagree. The section that asked for it shows its own
 * error state; nothing else on the screen is affected.
 */
export function validated<T>(path: string, parse: (value: unknown) => T, body: unknown): T {
  try {
    return parse(body);
  } catch (err) {
    if (!(err instanceof ApiContractError)) throw err;
    captureException(err, { tags: { boundary: "api-contract" }, extra: { path } });
    throw new Error(
      `The API's answer for ${path} isn't the shape this version of Cataloggy expects. ` +
        `That usually means the web and api containers are on different image tags — ` +
        `check that CATALOGGY_IMAGE_TAG matches for both.`,
      { cause: err }
    );
  }
}

/* ─── Sharing one GET between concurrent callers ─── */

/**
 * GETs already in flight, by what they are asking for.
 *
 * The dashboard is what this is for: its sections load in parallel and
 * independently, and the Shelf and the detail panel ask for overlapping rows
 * on top of that — so the same endpoint was fetched two and three times over
 * within a few milliseconds of each other, each one a full round trip. The API
 * solved exactly this for itself in `lib/coalesce.ts`; the client never had the
 * equivalent.
 *
 * An entry lives only as long as the request does. What to do with the *answer*
 * afterwards is the caching layer's business — `useCachedState` in memory, the
 * service worker on disk — and this deliberately holds no answers.
 */
const sharedGets = new Map<string, Promise<unknown>>();

/**
 * Which calls may be shared, and under what name.
 *
 * A plain GET with nothing caller-specific about it. A body, a custom header or
 * any other method means two requests that merely look alike are not the same
 * request. A caller-supplied signal excludes it too, for the reason the preload
 * adoption above gives: that request is one somebody expects to be able to
 * cancel, and cancelling it would take the other callers' answer with it.
 *
 * The key carries the identity as well as the path, so a profile switch in the
 * middle of a request can never hand the new profile the previous one's answer.
 */
const shareableKey = (path: string, method: string, init?: RequestOptions): string | null =>
  method === "GET" && !init?.body && !init?.headers && !init?.signal
    ? `${currentIdentity()}|${path}`
    : null;

/**
 * One API call, joining an identical GET that is already on the wire.
 *
 * A joiner takes the request as it was issued, including its timeout — which is
 * a per-endpoint constant at every call site, so the two were asking for the
 * same thing anyway.
 */
export function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const key = shareableKey(path, method, init);
  if (key === null) return performRequest<T>(path, init);

  const existing = sharedGets.get(key);
  if (existing) return existing as Promise<T>;

  const pending = performRequest<unknown>(path, init);
  const drop = () => {
    if (sharedGets.get(key) === pending) sharedGets.delete(key);
  };
  pending.then(drop, drop);
  sharedGets.set(key, pending);

  return pending as Promise<T>;
}
