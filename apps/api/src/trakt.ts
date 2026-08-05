import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";

const TRAKT_API_BASE = "https://api.trakt.tv";
const MAX_PAGES = 100;
const DEFAULT_POLL_MAX_PAGES = 20;
// A backfill walks every play the account has ever recorded, so it needs a far
// higher ceiling than an incremental poll: an account with a decade of history
// blows past 20 pages (2000 plays) in its first year alone, and anything the
// cap cuts off is history that silently never arrives.
const MAX_BACKFILL_PAGES = 1000;
const DEFAULT_BACKFILL_MAX_PAGES = 500;
const REQUEST_TIMEOUT_MS = 10_000;

function parseMaxPages(raw: string | undefined, fallback: number, ceiling: number): number {
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, ceiling);
}

const POLL_MAX_PAGES = parseMaxPages(process.env.TRAKT_POLL_MAX_PAGES, DEFAULT_POLL_MAX_PAGES, MAX_PAGES);
const BACKFILL_MAX_PAGES = parseMaxPages(
  process.env.TRAKT_BACKFILL_MAX_PAGES,
  DEFAULT_BACKFILL_MAX_PAGES,
  MAX_BACKFILL_PAGES
);
const DEFAULT_TOKEN_ROW_ID = "default";
const DEFAULT_TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export function computeTokenExpiresAt(expiresIn: number | undefined): Date {
  return typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000)
    : new Date(Date.now() + DEFAULT_TOKEN_EXPIRY_MS);
}

type TraktIds = {
  imdb?: string | null;
};

type TraktMoviePayload = {
  movie?: {
    title?: string;
    ids?: TraktIds;
  };
};

type TraktShowPayload = {
  show?: {
    title?: string;
    ids?: TraktIds;
  };
};

export type TraktRatedMoviePayload = {
  rated_at?: string;
  rating?: number;
  movie?: {
    title?: string;
    ids?: TraktIds;
  };
};

export type TraktRatedShowPayload = {
  rated_at?: string;
  rating?: number;
  show?: {
    title?: string;
    ids?: TraktIds;
  };
};

export type TraktRatedSeasonPayload = {
  rated_at?: string;
  rating?: number;
  season?: {
    number?: number;
    ids?: TraktIds;
  };
  show?: {
    title?: string;
    ids?: TraktIds;
  };
};

export type TraktRatedEpisodePayload = {
  rated_at?: string;
  rating?: number;
  episode?: {
    season?: number;
    number?: number;
    title?: string;
    ids?: TraktIds;
  };
  show?: {
    title?: string;
    ids?: TraktIds;
  };
};

export type TraktCollectedMoviePayload = {
  collected_at?: string;
  movie?: {
    title?: string;
    ids?: TraktIds;
  };
};

export type TraktCollectedShowPayload = {
  last_collected_at?: string;
  show?: {
    title?: string;
    ids?: TraktIds;
  };
};

export type TraktPersonalListPayload = {
  ids?: { trakt?: number; slug?: string };
  name?: string;
  description?: string | null;
  item_count?: number;
};

export type TraktListItemPayload = {
  type?: string;
  movie?: {
    title?: string;
    ids?: TraktIds;
  };
  show?: {
    title?: string;
    ids?: TraktIds;
  };
};

type TraktEpisodeHistoryPayload = {
  id?: number;
  watched_at?: string;
  action?: string;
  episode?: {
    season?: number;
    number?: number;
    title?: string;
    ids?: TraktIds;
  };
  show?: {
    title?: string;
    ids?: TraktIds;
  };
};

type TraktMovieHistoryPayload = {
  id?: number;
  watched_at?: string;
  action?: string;
  movie?: {
    title?: string;
    ids?: TraktIds;
  };
};

type TraktWatchedMoviePayload = {
  plays?: number;
  last_watched_at?: string;
  movie?: {
    title?: string;
    ids?: TraktIds;
  };
};

type TraktWatchedShowPayload = {
  plays?: number;
  last_watched_at?: string;
  show?: {
    title?: string;
    ids?: TraktIds;
  };
  seasons?: Array<{
    number?: number;
    episodes?: Array<{
      number?: number;
      plays?: number;
      last_watched_at?: string;
    }>;
  }>;
};

type TraktTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

export type TraktScrobblePayload =
  | { movie: { ids: { imdb: string } }; progress: number }
  | { show: { ids: { imdb: string } }; episode: { season: number; number: number }; progress: number };

export type TraktScrobbleResponse = {
  id?: number;
  action?: string;
  progress?: number;
};

export type TraktWatchlistMutationPayload = {
  movies?: { ids: { imdb: string } }[];
  shows?: { ids: { imdb: string } }[];
};

export class TraktClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly prisma: PrismaClient;
  private accessToken: string;
  private refreshToken: string;

  private constructor(options: {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    prisma: PrismaClient;
  }) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.prisma = options.prisma;
  }

  static async create(prisma: PrismaClient): Promise<TraktClient> {
    const clientId = process.env.TRAKT_CLIENT_ID;
    const clientSecret = process.env.TRAKT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("Trakt credentials are incomplete. Set TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET.");
    }

    const persistedToken = await prisma.traktToken.findUnique({ where: { id: DEFAULT_TOKEN_ROW_ID } });

    if (!persistedToken) {
      throw new Error(
        "Trakt tokens are missing. Complete the OAuth flow or seed a TraktToken row in the database."
      );
    }

    return new TraktClient({
      clientId,
      clientSecret,
      accessToken: persistedToken.accessToken,
      refreshToken: persistedToken.refreshToken,
      prisma
    });
  }

  async fetchWatchlistMovies(logger: FastifyBaseLogger): Promise<TraktMoviePayload[]> {
    return this.fetchAllPages<TraktMoviePayload>("/sync/watchlist/movies", logger);
  }

  async fetchWatchlistShows(logger: FastifyBaseLogger): Promise<TraktShowPayload[]> {
    return this.fetchAllPages<TraktShowPayload>("/sync/watchlist/shows", logger);
  }

  async fetchWatchedMovies(logger: FastifyBaseLogger): Promise<TraktWatchedMoviePayload[]> {
    return this.fetchAllPages<TraktWatchedMoviePayload>("/sync/watched/movies", logger);
  }

  async fetchWatchedShows(logger: FastifyBaseLogger): Promise<TraktWatchedShowPayload[]> {
    return this.fetchAllPages<TraktWatchedShowPayload>("/sync/watched/shows", logger);
  }

  // Ratings and the collection are only ever fetched in full, as part of a
  // one-time import, so they take the backfill cap rather than the poll-sized
  // default — a library past 10,000 entries would otherwise be cut off with
  // nothing to resume from.
  async fetchRatedMovies(logger: FastifyBaseLogger): Promise<TraktRatedMoviePayload[]> {
    return this.fetchAllPages<TraktRatedMoviePayload>("/sync/ratings/movies", logger, undefined, BACKFILL_MAX_PAGES);
  }

  async fetchRatedShows(logger: FastifyBaseLogger): Promise<TraktRatedShowPayload[]> {
    return this.fetchAllPages<TraktRatedShowPayload>("/sync/ratings/shows", logger, undefined, BACKFILL_MAX_PAGES);
  }

  async fetchRatedSeasons(logger: FastifyBaseLogger): Promise<TraktRatedSeasonPayload[]> {
    return this.fetchAllPages<TraktRatedSeasonPayload>("/sync/ratings/seasons", logger, undefined, BACKFILL_MAX_PAGES);
  }

  async fetchRatedEpisodes(logger: FastifyBaseLogger): Promise<TraktRatedEpisodePayload[]> {
    return this.fetchAllPages<TraktRatedEpisodePayload>("/sync/ratings/episodes", logger, undefined, BACKFILL_MAX_PAGES);
  }

  async fetchCollectionMovies(logger: FastifyBaseLogger): Promise<TraktCollectedMoviePayload[]> {
    return this.fetchAllPages<TraktCollectedMoviePayload>("/sync/collection/movies", logger, undefined, BACKFILL_MAX_PAGES);
  }

  async fetchCollectionShows(logger: FastifyBaseLogger): Promise<TraktCollectedShowPayload[]> {
    return this.fetchAllPages<TraktCollectedShowPayload>("/sync/collection/shows", logger, undefined, BACKFILL_MAX_PAGES);
  }

  /**
   * The user's own lists. Unlike the /sync endpoints this one is not paginated
   * — asking for page 2 returns the same full array again — so it is fetched as
   * a single request rather than through fetchAllPages, which would read that
   * repeat as more data and import every list twice.
   */
  async fetchPersonalLists(logger: FastifyBaseLogger): Promise<TraktPersonalListPayload[]> {
    const response = await this.request("/users/me/lists", {
      method: "GET",
      headers: {
        "trakt-api-version": "2",
        "trakt-api-key": this.clientId,
        Authorization: `Bearer ${this.accessToken}`
      },
      logger
    });

    try {
      return (await response.json()) as TraktPersonalListPayload[];
    } catch {
      throw new Error(`Trakt API returned non-JSON response for /users/me/lists (status ${response.status})`);
    }
  }

  // Movies and shows only: a personal list can also hold people, seasons and
  // episodes, none of which a Cataloggy list can hold.
  async fetchPersonalListItems(listId: number, logger: FastifyBaseLogger): Promise<TraktListItemPayload[]> {
    return this.fetchAllPages<TraktListItemPayload>(`/users/me/lists/${listId}/items/movie,show`, logger);
  }

  // No `startAt` means "everything Trakt has", not "the recent window with no
  // lower bound": the request goes out without `start_at` and under the much
  // larger backfill page cap, so a first sync brings in years of history rather
  // than the tail an incremental poll is sized for.
  async fetchMovieHistory(logger: FastifyBaseLogger, startAt?: string): Promise<TraktMovieHistoryPayload[]> {
    return this.fetchAllPages<TraktMovieHistoryPayload>(
      "/sync/history/movies",
      logger,
      startAt ? { start_at: startAt } : undefined,
      startAt ? POLL_MAX_PAGES : BACKFILL_MAX_PAGES
    );
  }

  async fetchEpisodeHistory(logger: FastifyBaseLogger, startAt?: string): Promise<TraktEpisodeHistoryPayload[]> {
    return this.fetchAllPages<TraktEpisodeHistoryPayload>(
      "/sync/history/episodes",
      logger,
      startAt ? { start_at: startAt } : undefined,
      startAt ? POLL_MAX_PAGES : BACKFILL_MAX_PAGES
    );
  }

  async scrobbleStart(payload: TraktScrobblePayload, logger: FastifyBaseLogger): Promise<TraktScrobbleResponse> {
    return this.postScrobble("/scrobble/start", payload, logger);
  }

  async scrobblePause(payload: TraktScrobblePayload, logger: FastifyBaseLogger): Promise<TraktScrobbleResponse> {
    return this.postScrobble("/scrobble/pause", payload, logger);
  }

  async scrobbleStop(payload: TraktScrobblePayload, logger: FastifyBaseLogger): Promise<TraktScrobbleResponse> {
    return this.postScrobble("/scrobble/stop", payload, logger);
  }

  private async postScrobble(
    path: string,
    payload: TraktScrobblePayload,
    logger: FastifyBaseLogger
  ): Promise<TraktScrobbleResponse> {
    const response = await this.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": this.clientId,
        Authorization: `Bearer ${this.accessToken}`
      },
      body: JSON.stringify(payload),
      logger
    });

    try {
      return (await response.json()) as TraktScrobbleResponse;
    } catch (error) {
      logger.warn({ error, path }, "Failed to parse Trakt scrobble response as JSON");
      return {};
    }
  }

  async addToWatchlist(payload: TraktWatchlistMutationPayload, logger: FastifyBaseLogger): Promise<void> {
    await this.postWatchlistMutation("/sync/watchlist", payload, logger);
  }

  async removeFromWatchlist(payload: TraktWatchlistMutationPayload, logger: FastifyBaseLogger): Promise<void> {
    await this.postWatchlistMutation("/sync/watchlist/remove", payload, logger);
  }

  private async postWatchlistMutation(
    path: string,
    payload: TraktWatchlistMutationPayload,
    logger: FastifyBaseLogger
  ): Promise<void> {
    await this.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": this.clientId,
        Authorization: `Bearer ${this.accessToken}`
      },
      body: JSON.stringify(payload),
      logger
    });
  }

  private async fetchAllPages<T>(
    path: string,
    logger: FastifyBaseLogger,
    queryParams?: Record<string, string>,
    maxPages: number = MAX_PAGES
  ): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    let hasMore = true;
    let reachedMaxPages = false;

    while (hasMore && page <= maxPages) {
      const response = await this.request(path, {
        method: "GET",
        headers: {
          "trakt-api-version": "2",
          "trakt-api-key": this.clientId,
          Authorization: `Bearer ${this.accessToken}`
        },
        queryParams,
        page,
        perPage: 100,
        logger
      });

      let pageItems: T[];
      try {
        pageItems = (await response.json()) as T[];
      } catch {
        throw new Error(`Trakt API returned non-JSON response for ${path} (page ${page}, status ${response.status})`);
      }
      items.push(...pageItems);

      const totalPagesHeader = response.headers.get("x-pagination-page-count");
      const totalPages = totalPagesHeader ? Number.parseInt(totalPagesHeader, 10) : NaN;

      if (!Number.isNaN(totalPages) && totalPages > 0) {
        hasMore = page < Math.min(totalPages, maxPages);
        reachedMaxPages = totalPages > maxPages && !hasMore;
      } else {
        hasMore = pageItems.length >= 100;
      }

      page += 1;

      if (hasMore && page > maxPages) {
        reachedMaxPages = true;
      }
    }

    if (reachedMaxPages) {
      logger.warn({ path, maxPages }, "Reached maximum Trakt pagination limit");
    }

    return items;
  }

  private async request(
    path: string,
    options: {
      method: "GET" | "POST";
      headers: Record<string, string>;
      body?: string;
      queryParams?: Record<string, string>;
      page?: number;
      perPage?: number;
      logger: FastifyBaseLogger;
      allowRefresh?: boolean;
    }
  ): Promise<Response> {
    const url = new URL(path, TRAKT_API_BASE);
    if (options.page !== undefined) {
      url.searchParams.set("page", String(options.page));
    }

    if (options.queryParams) {
      for (const [key, value] of Object.entries(options.queryParams)) {
        url.searchParams.set(key, value);
      }
    }

    if (options.perPage !== undefined) {
      url.searchParams.set("limit", String(options.perPage));
    }

    const response = await fetch(url, {
      method: options.method,
      headers: { "User-Agent": "Cataloggy/1.0", ...options.headers },
      body: options.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (response.status === 401 && options.allowRefresh !== false) {
      await this.refreshAccessToken(options.logger);
      return this.request(path, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${this.accessToken}`
        },
        allowRefresh: false
      });
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Trakt request failed (${response.status}) for ${path}: ${body}`);
    }

    return response;
  }

  private async refreshAccessToken(logger: FastifyBaseLogger) {
    const response = await fetch(new URL("/oauth/token", TRAKT_API_BASE), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Cataloggy/1.0"
      },
      body: JSON.stringify({
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token"
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to refresh Trakt token (${response.status}): ${body}`);
    }

    const tokenResponse = (await response.json()) as TraktTokenResponse;
    this.accessToken = tokenResponse.access_token;
    this.refreshToken = tokenResponse.refresh_token;

    const expiresAt = computeTokenExpiresAt(tokenResponse.expires_in);

    await this.prisma.traktToken.upsert({
      where: { id: DEFAULT_TOKEN_ROW_ID },
      update: {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiresAt
      },
      create: {
        id: DEFAULT_TOKEN_ROW_ID,
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiresAt
      }
    });

    logger.info("Trakt tokens refreshed and persisted");
  }
}
