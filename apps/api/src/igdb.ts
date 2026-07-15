const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_API_BASE = "https://api.igdb.com/v4";
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const RATE_LIMIT_PER_SECOND = 4;
const REQUEST_TIMEOUT_MS = 10_000;

type IgdbTokenResponse = {
  access_token: string;
  expires_in: number;
};

type IgdbGamePayload = {
  id: number;
  name: string;
  cover?: { image_id?: string } | null;
  first_release_date?: number;
  genres?: { name: string }[];
};

export type IgdbGameSummary = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  releaseDate: string | null;
  genres: string[];
};

export function igdbCoverUrl(imageId: string): string {
  return `https://images.igdb.com/igdb/image/upload/t_720p/${imageId}.jpg`;
}

function transformGame(game: IgdbGamePayload): IgdbGameSummary {
  return {
    igdbId: game.id,
    title: game.name,
    coverUrl: game.cover?.image_id ? igdbCoverUrl(game.cover.image_id) : null,
    releaseDate: game.first_release_date
      ? new Date(game.first_release_date * 1000).toISOString().split("T")[0]
      : null,
    genres: (game.genres ?? []).map((genre) => genre.name)
  };
}

// Apicalypse strings are double-quoted; escape backslashes/quotes so a title like
// `Portal 2: "Aperture"` can't break out of the search clause.
function escapeApicalypseString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

type QueuedTask = { run: () => Promise<void> };

// Queues IGDB requests to stay under its 4 requests/second limit.
class RateLimiter {
  private queue: QueuedTask[] = [];
  private processing = false;
  private readonly intervalMs: number;

  constructor(requestsPerSecond: number) {
    this.intervalMs = 1000 / requestsPerSecond;
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: async () => {
          try {
            resolve(await fn());
          } catch (error) {
            reject(error);
          }
        }
      });
      if (!this.processing) void this.process();
    });
  }

  private async process(): Promise<void> {
    const next = this.queue.shift();
    if (!next) {
      this.processing = false;
      return;
    }

    this.processing = true;
    await next.run();
    setTimeout(() => void this.process(), this.intervalMs);
  }
}

const limiter = new RateLimiter(RATE_LIMIT_PER_SECOND);

let cachedToken: string | null = null;
let tokenExpiresAt: number | null = null;

export class IgdbClient {
  private constructor(
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  static fromEnv(): IgdbClient {
    const clientId = process.env.TWITCH_CLIENT_ID?.trim();
    const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      throw new Error("Twitch credentials are incomplete. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.");
    }

    return new IgdbClient(clientId, clientSecret);
  }

  async searchGames(query: string, limit = 20): Promise<IgdbGameSummary[]> {
    const apicalypse = `fields name,cover.image_id,first_release_date,genres.name; search "${escapeApicalypseString(query)}"; limit ${limit};`;
    const games = await this.request("/games", apicalypse);
    return games.map(transformGame);
  }

  async getGameById(igdbId: number): Promise<IgdbGameSummary | null> {
    const apicalypse = `fields name,cover.image_id,first_release_date,genres.name; where id = ${igdbId}; limit 1;`;
    const games = await this.request("/games", apicalypse);
    return games[0] ? transformGame(games[0]) : null;
  }

  // Best-effort title match used by the Steam sync to attach IGDB artwork/metadata to a
  // Steam library entry: exact (case-insensitive) match first, falling back to a result
  // whose name contains the query as a substring. No match at all (rather than the
  // top search hit) is returned when neither is found, since an unrelated top result
  // would silently attach wrong artwork/genres to the Steam entry.
  async findBestMatch(title: string): Promise<IgdbGameSummary | null> {
    const results = await this.searchGames(title, 10);
    if (results.length === 0) return null;

    const normalized = title.trim().toLowerCase();
    const exact = results.find((game) => game.title.trim().toLowerCase() === normalized);
    if (exact) return exact;

    return results.find((game) => game.title.trim().toLowerCase().includes(normalized)) ?? null;
  }

  private async getAccessToken(): Promise<string> {
    if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
      return cachedToken;
    }

    const response = await fetch(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "client_credentials"
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to get Twitch OAuth token (${response.status}): ${body}`);
    }

    const data = (await response.json()) as IgdbTokenResponse;
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;

    return cachedToken;
  }

  private async request(endpoint: string, query: string): Promise<IgdbGamePayload[]> {
    const token = await this.getAccessToken();

    return limiter.add(async () => {
      const response = await fetch(`${IGDB_API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          "Client-ID": this.clientId,
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain"
        },
        body: query,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          cachedToken = null;
          tokenExpiresAt = null;
        }
        const body = await response.text();
        throw new Error(`IGDB request failed (${response.status}) for ${endpoint}: ${body}`);
      }

      return (await response.json()) as IgdbGamePayload[];
    });
  }
}

/** Test-only: clears the module-level Twitch token cache between test cases. */
export function resetIgdbTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = null;
}
