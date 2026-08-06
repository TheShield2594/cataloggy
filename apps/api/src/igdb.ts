const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_API_BASE = "https://api.igdb.com/v4";
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const RATE_LIMIT_PER_SECOND = 4;
const REQUEST_TIMEOUT_MS = 10_000;

// How many rows each of the two search strategies asks for before they are
// merged and re-ranked. Wider than the caller's limit on purpose: the whole
// point is that neither strategy alone puts the right game near the top.
const CANDIDATE_LIMIT = 30;

const GAME_FIELDS =
  "fields name,cover.image_id,first_release_date,genres.name,total_rating_count,version_parent;";

// A search is the same answer for everyone, so the result is worth holding on
// to briefly: typing "mario", backspacing and typing it again — or two profiles
// looking for the same game — otherwise spends IGDB's 4-requests-per-second
// budget twice over, and every queued request delays the one the user is
// waiting on.
const SEARCH_CACHE_TTL_MS = 5 * 60_000;
const SEARCH_CACHE_MAX_ENTRIES = 100;

type IgdbTokenResponse = {
  access_token: string;
  expires_in: number;
};

export type IgdbGamePayload = {
  id: number;
  name: string;
  cover?: { image_id?: string } | null;
  first_release_date?: number;
  genres?: { name: string }[];
  total_rating_count?: number | null;
  // Set on editions, re-releases and regional variants ("… : Limited Edition"),
  // pointing at the game they are a version of.
  version_parent?: number | null;
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

// Titles are punctuated inconsistently ("Super Mario Bros." vs "Super Mario Bros",
// "Ratchet & Clank" vs "Ratchet and Clank"), and none of that punctuation is
// something anyone types deliberately. Comparing on letters and digits alone
// keeps "super mario bros" an *exact* hit for "Super Mario Bros." rather than a
// mere substring one.
function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * How well a title answers the query, as a coarse tier — the same exact >
 * prefix > word-start > substring ladder the movie/series merge uses, plus a
 * bottom tier for rows IGDB's fuzzy index returned without the title matching
 * at all (an alternative name, a typo-tolerant hit, or simply a loose one).
 */
function titleMatchTier(name: string, normalizedQuery: string): number {
  const n = normalizeTitle(name);
  if (!normalizedQuery) return 0;
  if (n === normalizedQuery) return 4;
  if (n.startsWith(normalizedQuery)) return 3;
  if (` ${n}`.includes(` ${normalizedQuery}`)) return 2;
  if (n.includes(normalizedQuery)) return 1;
  return 0;
}

/**
 * Merges the candidates from both search strategies into one ordered list.
 *
 * IGDB's own relevance order is unreliable for the queries people actually
 * type: "Super Mario" leads with a boxed re-release and a fan game while the
 * games with those words in their name and millions of players sit below the
 * cut. So the order here is decided locally — how well the title matches
 * first, then how many people have rated the game, then whichever strategy
 * ranked it higher — and an edition or regional variant is demoted a tier,
 * since a version of a game is never a better answer than the game itself.
 */
export function rankGameCandidates(candidates: IgdbGamePayload[], query: string): IgdbGamePayload[] {
  const normalizedQuery = normalizeTitle(query);

  const seen = new Set<number>();
  const unique: { game: IgdbGamePayload; tier: number; rank: number }[] = [];
  candidates.forEach((game, rank) => {
    if (seen.has(game.id)) return;
    seen.add(game.id);
    const isVersion = game.version_parent != null;
    const tier = Math.max(0, titleMatchTier(game.name, normalizedQuery) - (isVersion ? 1 : 0));
    unique.push({ game, tier, rank });
  });

  unique.sort((a, b) => {
    if (a.tier !== b.tier) return b.tier - a.tier;
    const popularity = (b.game.total_rating_count ?? 0) - (a.game.total_rating_count ?? 0);
    if (popularity !== 0) return popularity;
    return a.rank - b.rank;
  });

  return unique.map((entry) => entry.game);
}

type CachedSearch = { at: number; results: IgdbGameSummary[] };
const searchCache = new Map<string, CachedSearch>();

function readSearchCache(key: string): IgdbGameSummary[] | null {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  // Re-insert so the eviction below drops the least recently *used* entry.
  searchCache.delete(key);
  searchCache.set(key, hit);
  return hit.results;
}

function writeSearchCache(key: string, results: IgdbGameSummary[]): void {
  searchCache.set(key, { at: Date.now(), results });
  while (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldest = searchCache.keys().next();
    if (oldest.done) break;
    searchCache.delete(oldest.value);
  }
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
// A search fires two IGDB requests at once, and on a cold start both would ask
// Twitch for a token before either had one to cache. Whoever asks first owns
// the request; everyone else waits on it.
let pendingToken: Promise<string> | null = null;

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

  /**
   * Two queries, not one. IGDB's `search` is a fuzzy index that also matches
   * alternative names, which is what finds a game someone half-remembers — but
   * it drops well-known titles outright for some queries, and orders what it
   * does return by a relevance score that favours obscure editions. The second
   * query is a literal "name contains this" over games with enough ratings to
   * be the one being looked for, which is the half that reliably surfaces
   * `Super Mario Sunshine` for `super mario sunshine`.
   *
   * Either half failing is survivable — the other's results are still returned,
   * which is no worse than the single query this replaced.
   */
  async searchGames(query: string, limit = 20): Promise<IgdbGameSummary[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = normalizeTitle(trimmed);
    const cached = readSearchCache(cacheKey);
    if (cached) return cached.slice(0, limit);

    const escaped = escapeApicalypseString(trimmed);
    const [fuzzy, literal] = await Promise.allSettled([
      this.request("/games", `${GAME_FIELDS} search "${escaped}"; limit ${CANDIDATE_LIMIT};`),
      this.request(
        "/games",
        `${GAME_FIELDS} where name ~ *"${escaped}"* & version_parent = null & total_rating_count != null; sort total_rating_count desc; limit ${CANDIDATE_LIMIT};`
      )
    ]);

    if (fuzzy.status === "rejected" && literal.status === "rejected") {
      throw fuzzy.reason;
    }

    const candidates = [
      ...(fuzzy.status === "fulfilled" ? fuzzy.value : []),
      ...(literal.status === "fulfilled" ? literal.value : [])
    ];

    const results = rankGameCandidates(candidates, trimmed).map(transformGame);
    // Only a complete answer is worth caching: a half that failed would
    // otherwise pin its gap in place for the next five minutes.
    if (fuzzy.status === "fulfilled" && literal.status === "fulfilled") {
      writeSearchCache(cacheKey, results);
    }
    return results.slice(0, limit);
  }

  async getGameById(igdbId: number): Promise<IgdbGameSummary | null> {
    const apicalypse = `${GAME_FIELDS} where id = ${igdbId}; limit 1;`;
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

    const normalized = normalizeTitle(title);
    if (!normalized) return null;
    const exact = results.find((game) => normalizeTitle(game.title) === normalized);
    if (exact) return exact;

    return results.find((game) => normalizeTitle(game.title).includes(normalized)) ?? null;
  }

  private async getAccessToken(): Promise<string> {
    if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
      return cachedToken;
    }
    if (pendingToken) return pendingToken;

    const request = this.fetchAccessToken().finally(() => {
      pendingToken = null;
    });
    pendingToken = request;
    return request;
  }

  private async fetchAccessToken(): Promise<string> {
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

/** Test-only: clears the module-level Twitch token and search caches between test cases. */
export function resetIgdbTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = null;
  pendingToken = null;
  searchCache.clear();
}
