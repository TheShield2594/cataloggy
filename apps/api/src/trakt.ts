import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";

const TRAKT_API_BASE = "https://api.trakt.tv";
const MAX_PAGES = 100;
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

type TraktEpisodeHistoryPayload = {
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

  async fetchMovieHistory(logger: FastifyBaseLogger, startAt?: string): Promise<TraktMovieHistoryPayload[]> {
    return this.fetchAllPages<TraktMovieHistoryPayload>("/sync/history/movies", logger, startAt ? { start_at: startAt } : undefined);
  }

  async fetchEpisodeHistory(logger: FastifyBaseLogger, startAt?: string): Promise<TraktEpisodeHistoryPayload[]> {
    return this.fetchAllPages<TraktEpisodeHistoryPayload>("/sync/history/episodes", logger, startAt ? { start_at: startAt } : undefined);
  }

  private async fetchAllPages<T>(
    path: string,
    logger: FastifyBaseLogger,
    queryParams?: Record<string, string>
  ): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    let pageCount = 1;

    while (page <= pageCount && page <= MAX_PAGES) {
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
      const parsedTotalPages = totalPagesHeader ? Number.parseInt(totalPagesHeader, 10) : NaN;

      if (!Number.isNaN(parsedTotalPages) && parsedTotalPages > 0) {
        pageCount = Math.min(parsedTotalPages, MAX_PAGES);
      } else if (pageItems.length < 100) {
        pageCount = page;
      } else {
        pageCount = Math.min(page + 1, MAX_PAGES);
      }

      page += 1;
    }

    if (pageCount >= MAX_PAGES) {
      logger.warn({ path, maxPages: MAX_PAGES }, "Reached maximum Trakt pagination limit");
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
      headers: options.headers,
      body: options.body
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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token"
      })
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

export type { TraktEpisodeHistoryPayload, TraktMovieHistoryPayload, TraktMoviePayload, TraktShowPayload, TraktWatchedMoviePayload, TraktWatchedShowPayload };
