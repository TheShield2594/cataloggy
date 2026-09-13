import { ApiContractError, deriveServiceToken, SERVICE_TOKEN_HEADER } from "@cataloggy/shared";
import { CATALOGGY_API_BASE, CATALOGGY_API_TOKEN } from "./config.js";

/**
 * How this service talks to the Cataloggy API.
 *
 * Every route here is a thin translation of one or two API calls into Stremio's
 * wire shape, so this is the only place that knows the base URL, the
 * credentials, the timeout, and what to do when the API answers with something
 * other than what its contract says.
 */

// Proves these calls come from the addon rather than from a browser holding the
// same API token, so the API can rate-limit them separately — every Stremio
// client's requests reach the API from this one container's IP.
const SERVICE_TOKEN = CATALOGGY_API_TOKEN ? deriveServiceToken(CATALOGGY_API_TOKEN) : null;

export const apiHeaders = (profileId?: string | null): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (SERVICE_TOKEN) headers[SERVICE_TOKEN_HEADER] = SERVICE_TOKEN;
  if (CATALOGGY_API_TOKEN) headers.Authorization = `Bearer ${CATALOGGY_API_TOKEN}`;
  if (profileId) headers["x-profile-id"] = profileId;
  return headers;
};

const FETCH_TIMEOUT_MS = 10_000;

export const fetchWithTimeout = async (url: string | URL, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${String(url)} timed out after ${FETCH_TIMEOUT_MS}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

/** An API URL, for a caller that has to make the request itself. */
export const apiUrl = (path: string): URL => new URL(path, CATALOGGY_API_BASE);

// Every response is run through the contract parser for its endpoint rather
// than asserted into the expected type. An API that changes shape used to
// surface as an empty Stremio row with nothing in the logs; now it is a named
// error at the boundary, which every caller here already degrades gracefully on.
export const apiGet = async <T>(
  path: string,
  profileId: string | null | undefined,
  parse: (value: unknown) => T
): Promise<T> => {
  const response = await fetchWithTimeout(apiUrl(path), { headers: apiHeaders(profileId) });
  if (!response.ok) throw new Error(`API ${path} returned ${response.status}`);
  const payload: unknown = await response.json();
  try {
    return parse(payload);
  } catch (error) {
    throw new ApiContractError(
      `API ${path} returned an unexpected shape: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
};

// Unlike apiGet there is no contract to check: every caller either ignores the
// response or hands it straight back to the client without reading a field.
export const apiPost = async (path: string, body?: unknown, profileId?: string | null): Promise<unknown> => {
  const response = await fetchWithTimeout(apiUrl(path), {
    method: "POST",
    headers: {
      ...apiHeaders(profileId),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`API POST ${path} returned ${response.status}`);
  return response.json();
};
