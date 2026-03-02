import type { FastifyBaseLogger } from "fastify";

const TRAKT_API_BASE = "https://api.trakt.tv";
const MAX_PAGES = 100;

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

type TraktTokenResponse = {
  access_token: string;
  refresh_token: string;
};

export class TraktClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private accessToken: string;
  private refreshToken: string;
  private hasLoggedPersistenceWarning = false;

  constructor() {
    const clientId = process.env.TRAKT_CLIENT_ID;
    const clientSecret = process.env.TRAKT_CLIENT_SECRET;
    const accessToken = process.env.TRAKT_ACCESS_TOKEN;
    const refreshToken = process.env.TRAKT_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !accessToken || !refreshToken) {
      throw new Error(
        "Trakt credentials are incomplete. Set TRAKT_CLIENT_ID, TRAKT_CLIENT_SECRET, TRAKT_ACCESS_TOKEN, and TRAKT_REFRESH_TOKEN."
      );
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  async fetchWatchlistMovies(logger: FastifyBaseLogger): Promise<TraktMoviePayload[]> {
    return this.fetchAllPages<TraktMoviePayload>("/sync/watchlist/movies", logger);
  }

  async fetchWatchlistShows(logger: FastifyBaseLogger): Promise<TraktShowPayload[]> {
    return this.fetchAllPages<TraktShowPayload>("/sync/watchlist/shows", logger);
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

      const pageItems = (await response.json()) as T[];
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

    if (!this.hasLoggedPersistenceWarning) {
      logger.warn(
        "Trakt tokens were refreshed in memory only. Persist refreshed tokens to durable storage for production use."
      );
      this.hasLoggedPersistenceWarning = true;
    }
  }
}

export type { TraktEpisodeHistoryPayload, TraktMovieHistoryPayload, TraktMoviePayload, TraktShowPayload };
