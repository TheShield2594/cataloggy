const STEAM_API_BASE = "https://api.steampowered.com";
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 10_000;

type SteamOwnedGamesResponse = {
  response?: {
    game_count?: number;
    games?: {
      appid: number;
      name?: string;
      playtime_forever?: number;
      playtime_2weeks?: number;
      rtime_last_played?: number;
      img_icon_url?: string;
    }[];
  };
};

type SteamPlayerSummariesResponse = {
  response?: {
    players?: {
      steamid?: string;
      personaname?: string;
      avatarfull?: string;
      profileurl?: string;
    }[];
  };
};

export type SteamOwnedGame = {
  appId: number;
  name: string;
  playtimeForeverMinutes: number;
  playtime2WeeksMinutes: number;
  lastPlayedAt: Date | null;
  iconUrl: string | null;
};

export type SteamPlayerSummary = {
  steamId: string;
  username: string;
  avatar: string | null;
  profileUrl: string | null;
};

// Steam occasionally 429s/503s under load; a short exponential backoff clears
// most of these without giving up on what is otherwise a healthy request.
async function fetchWithRetry(url: URL, maxRetries: number = MAX_RETRIES): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to reach Steam after retries");
}

export class SteamClient {
  private constructor(private readonly apiKey: string) {}

  static fromEnv(): SteamClient {
    const apiKey = process.env.STEAM_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("STEAM_API_KEY is not configured");
    }

    return new SteamClient(apiKey);
  }

  async getOwnedGames(steamId: string): Promise<SteamOwnedGame[]> {
    const url = new URL(`${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v0001/`);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("steamid", steamId);
    url.searchParams.set("include_appinfo", "1");
    url.searchParams.set("include_played_free_games", "1");

    const response = await fetchWithRetry(url);
    if (!response.ok) {
      throw new Error(`Steam GetOwnedGames request failed (${response.status})`);
    }

    const data = (await response.json()) as SteamOwnedGamesResponse;
    const games = data.response?.games ?? [];

    return games.map((game) => ({
      appId: game.appid,
      name: game.name?.trim() || `Steam App ${game.appid}`,
      playtimeForeverMinutes: game.playtime_forever ?? 0,
      playtime2WeeksMinutes: game.playtime_2weeks ?? 0,
      lastPlayedAt: game.rtime_last_played ? new Date(game.rtime_last_played * 1000) : null,
      iconUrl: game.img_icon_url
        ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
        : null
    }));
  }

  async getPlayerSummary(steamId: string): Promise<SteamPlayerSummary | null> {
    const url = new URL(`${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v0002/`);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("steamids", steamId);

    const response = await fetchWithRetry(url);
    if (!response.ok) {
      throw new Error(`Steam GetPlayerSummaries request failed (${response.status})`);
    }

    const data = (await response.json()) as SteamPlayerSummariesResponse;
    const player = data.response?.players?.[0];
    if (!player?.steamid) return null;

    return {
      steamId: player.steamid,
      username: player.personaname?.trim() || "Unknown",
      avatar: player.avatarfull ?? null,
      profileUrl: player.profileurl ?? null
    };
  }
}
