import { MetadataType } from "@prisma/client";

type TmdbMediaType = "movie" | "tv";

type TmdbSearchResult = {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
  genre_ids?: number[];
  vote_average?: number;
  vote_count?: number;
};

type TmdbDetailsResult = TmdbSearchResult & {
  genres?: { id: number; name: string }[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  runtime?: number | null;
  episode_run_time?: number[];
  status?: string;
  networks?: { id: number; name: string; origin_country: string }[];
  production_companies?: { id: number; name: string }[];
  seasons?: {
    id: number;
    name: string;
    season_number: number;
    episode_count: number;
    air_date?: string | null;
    poster_path?: string | null;
  }[];
  // append_to_response: release_dates (movie)
  release_dates?: {
    results: {
      iso_3166_1: string;
      release_dates: { certification: string; type: number }[];
    }[];
  };
  // append_to_response: content_ratings (tv)
  content_ratings?: {
    results: { iso_3166_1: string; rating: string }[];
  };
};

type TmdbExternalIds = {
  imdb_id?: string | null;
};

type TmdbSearchResponse = {
  results?: TmdbSearchResult[];
};

type TmdbDetailsResponse = TmdbDetailsResult;

type TmdbFindResponse = {
  movie_results?: TmdbSearchResult[];
  tv_results?: TmdbSearchResult[];
};

type TmdbCreditsResponse = {
  cast?: {
    id: number;
    name: string;
    character: string;
    profile_path?: string | null;
    order: number;
  }[];
};

export type CastMember = {
  name: string;
  character: string;
  photo: string | null;
  order: number;
};

export type SeasonInfo = {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airYear: number | null;
  poster: string | null;
};

export type MetadataPayload = {
  imdbId: string;
  type: MetadataType;
  tmdbId: number | null;
  name: string;
  year: number | null;
  poster: string | null;
  background: string | null;
  description: string | null;
  genres: string[];
  rating: number | null;
  voteCount: number | null;
  totalSeasons: number | null;
  totalEpisodes: number | null;
  runtime: number | null;
  certification: string | null;
  status: string | null;
  network: string | null;
  releaseDate: string | null;
};

// Standard TMDB genre IDs (movie + TV combined)
const TMDB_GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};

// Common streaming provider IDs on TMDB
export const STREAMING_PROVIDERS: Record<string, { id: number; name: string }> = {
  netflix: { id: 8, name: "Netflix" },
  amazon: { id: 9, name: "Amazon Prime Video" },
  disney: { id: 337, name: "Disney+" },
  apple: { id: 350, name: "Apple TV+" },
  hulu: { id: 15, name: "Hulu" },
  max: { id: 1899, name: "Max" },
  paramount: { id: 531, name: "Paramount+" },
  peacock: { id: 386, name: "Peacock" },
  crunchyroll: { id: 283, name: "Crunchyroll" },
};

export class TmdbClient {
  private static readonly baseUrl = "https://api.themoviedb.org/3";
  private static readonly imageBaseUrl = "https://image.tmdb.org/t/p/w500";
  private static readonly profileBaseUrl = "https://image.tmdb.org/t/p/w185";

  private readonly language: string;

  private constructor(private readonly apiKey: string, language?: string) {
    this.language = language ?? "en-US";
  }

  static fromEnv(language?: string) {
    const apiKey = process.env.TMDB_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("TMDB_API_KEY is not configured");
    }

    return new TmdbClient(apiKey, language);
  }

  async search(type: MetadataType, query: string): Promise<MetadataPayload[]> {
    const mediaType = this.toMediaType(type);
    const response = await this.request<TmdbSearchResponse>(`/search/${mediaType}`, { query });
    const results = response.results ?? [];

    const withImdb = await Promise.all(
      results.map(async (result) => {
        if (!result.id) {
          return null;
        }

        const externalIds = await this.getExternalIds(mediaType, result.id);
        const imdbId = externalIds.imdb_id?.trim();
        if (!imdbId) {
          return null;
        }

        return this.toMetadataPayload(type, result, imdbId);
      })
    );

    return withImdb.filter((item): item is MetadataPayload => item !== null);
  }

  async searchMulti(query: string): Promise<MetadataPayload[]> {
    const response = await this.request<TmdbSearchResponse>("/search/multi", { query });
    const results = (response.results ?? []).filter(
      (r) => r.media_type === "movie" || r.media_type === "tv"
    );

    const withImdb = await Promise.all(
      results.map(async (result) => {
        if (!result.id || !result.media_type) {
          return null;
        }

        const mediaType = result.media_type as TmdbMediaType;
        const type = mediaType === "movie" ? MetadataType.movie : MetadataType.series;
        const externalIds = await this.getExternalIds(mediaType, result.id);
        const imdbId = externalIds.imdb_id?.trim();
        if (!imdbId) {
          return null;
        }

        return this.toMetadataPayload(type, result, imdbId);
      })
    );

    return withImdb.filter((item): item is MetadataPayload => item !== null);
  }

  async trending(type: MetadataType, timeWindow: "day" | "week" = "week"): Promise<MetadataPayload[]> {
    const mediaType = this.toMediaType(type);
    const response = await this.request<TmdbSearchResponse>(`/trending/${mediaType}/${timeWindow}`);
    const results = response.results ?? [];

    const withImdb = await Promise.all(
      results.slice(0, 20).map(async (result) => {
        if (!result.id) return null;
        const externalIds = await this.getExternalIds(mediaType, result.id);
        const imdbId = externalIds.imdb_id?.trim();
        if (!imdbId) return null;
        return this.toMetadataPayload(type, result, imdbId);
      })
    );

    return withImdb.filter((item): item is MetadataPayload => item !== null);
  }

  async popular(type: MetadataType): Promise<MetadataPayload[]> {
    const mediaType = this.toMediaType(type);
    const response = await this.request<TmdbSearchResponse>(`/${mediaType}/popular`);
    const results = response.results ?? [];

    const withImdb = await Promise.all(
      results.slice(0, 20).map(async (result) => {
        if (!result.id) return null;
        const externalIds = await this.getExternalIds(mediaType, result.id);
        const imdbId = externalIds.imdb_id?.trim();
        if (!imdbId) return null;
        return this.toMetadataPayload(type, result, imdbId);
      })
    );

    return withImdb.filter((item): item is MetadataPayload => item !== null);
  }

  async recommendations(type: MetadataType, tmdbId: number): Promise<MetadataPayload[]> {
    const mediaType = this.toMediaType(type);
    const response = await this.request<TmdbSearchResponse>(`/${mediaType}/${tmdbId}/recommendations`);
    const results = response.results ?? [];

    const withImdb = await Promise.all(
      results.slice(0, 20).map(async (result) => {
        if (!result.id) return null;
        const externalIds = await this.getExternalIds(mediaType, result.id);
        const imdbId = externalIds.imdb_id?.trim();
        if (!imdbId) return null;
        return this.toMetadataPayload(type, result, imdbId);
      })
    );

    return withImdb.filter((item): item is MetadataPayload => item !== null);
  }

  async discoverByProvider(type: MetadataType, providerId: number, region: string = "US"): Promise<MetadataPayload[]> {
    const mediaType = this.toMediaType(type);
    const response = await this.request<TmdbSearchResponse>(`/discover/${mediaType}`, {
      with_watch_providers: String(providerId),
      watch_region: region,
      sort_by: "popularity.desc",
    });
    const results = response.results ?? [];

    const withImdb = await Promise.all(
      results.slice(0, 20).map(async (result) => {
        if (!result.id) return null;
        const externalIds = await this.getExternalIds(mediaType, result.id);
        const imdbId = externalIds.imdb_id?.trim();
        if (!imdbId) return null;
        return this.toMetadataPayload(type, result, imdbId);
      })
    );

    return withImdb.filter((item): item is MetadataPayload => item !== null);
  }

  async discoverAnime(type: MetadataType): Promise<MetadataPayload[]> {
    const mediaType = this.toMediaType(type);
    const params: Record<string, string> = {
      with_genres: "16", // Animation
      sort_by: "popularity.desc",
    };
    // For TV, filter by Japanese origin
    if (mediaType === "tv") {
      params.with_origin_country = "JP";
    }
    // For movies, use original language
    if (mediaType === "movie") {
      params.with_original_language = "ja";
    }

    const response = await this.request<TmdbSearchResponse>(`/discover/${mediaType}`, params);
    const results = response.results ?? [];

    const withImdb = await Promise.all(
      results.slice(0, 20).map(async (result) => {
        if (!result.id) return null;
        const externalIds = await this.getExternalIds(mediaType, result.id);
        const imdbId = externalIds.imdb_id?.trim();
        if (!imdbId) return null;
        return this.toMetadataPayload(type, result, imdbId);
      })
    );

    return withImdb.filter((item): item is MetadataPayload => item !== null);
  }

  async getShowDetails(tmdbId: number): Promise<{
    nextEpisodeToAir: { season_number: number; episode_number: number; name: string; air_date: string; overview?: string } | null;
    lastEpisodeToAir: { season_number: number; episode_number: number; name: string; air_date: string } | null;
    status: string | null;
  } | null> {
    try {
      const data = await this.request<{
        next_episode_to_air?: { season_number: number; episode_number: number; name: string; air_date: string; overview?: string } | null;
        last_episode_to_air?: { season_number: number; episode_number: number; name: string; air_date: string } | null;
        status?: string;
      }>(`/tv/${tmdbId}`);
      return {
        nextEpisodeToAir: data.next_episode_to_air ?? null,
        lastEpisodeToAir: data.last_episode_to_air ?? null,
        status: data.status ?? null,
      };
    } catch {
      return null;
    }
  }

  async findByImdbId(type: MetadataType, imdbId: string): Promise<MetadataPayload | null> {
    const findResponse = await this.request<TmdbFindResponse>(`/find/${encodeURIComponent(imdbId)}`, {
      external_source: "imdb_id"
    });

    const result = type === MetadataType.movie ? findResponse.movie_results?.[0] : findResponse.tv_results?.[0];
    if (!result?.id) {
      return null;
    }

    const mediaType = this.toMediaType(type);
    const appendFields = mediaType === "movie" ? "release_dates" : "content_ratings";
    const details = await this.request<TmdbDetailsResponse>(`/${mediaType}/${result.id}`, {
      append_to_response: appendFields,
    });

    return this.toMetadataPayloadFromDetails(type, details, imdbId);
  }

  async getCast(type: MetadataType, tmdbId: number): Promise<CastMember[]> {
    const mediaType = this.toMediaType(type);
    try {
      const data = await this.request<TmdbCreditsResponse>(`/${mediaType}/${tmdbId}/credits`);
      return (data.cast ?? [])
        .sort((a, b) => a.order - b.order)
        .slice(0, 20)
        .map((c) => ({
          name: c.name,
          character: c.character,
          photo: c.profile_path ? `${TmdbClient.profileBaseUrl}${c.profile_path}` : null,
          order: c.order,
        }));
    } catch {
      return [];
    }
  }

  async getSeasons(tmdbId: number): Promise<SeasonInfo[]> {
    try {
      const data = await this.request<{ seasons?: TmdbDetailsResult["seasons"] }>(`/tv/${tmdbId}`);
      return (data.seasons ?? [])
        .filter((s) => s.season_number > 0) // skip "Specials" season 0
        .map((s) => ({
          seasonNumber: s.season_number,
          name: s.name,
          episodeCount: s.episode_count,
          airYear: s.air_date ? new Date(s.air_date).getUTCFullYear() : null,
          poster: s.poster_path ? `${TmdbClient.imageBaseUrl}${s.poster_path}` : null,
        }));
    } catch {
      return [];
    }
  }

  private async getExternalIds(mediaType: TmdbMediaType, tmdbId: number) {
    return this.request<TmdbExternalIds>(`/${mediaType}/${tmdbId}/external_ids`);
  }

  private parseCertification(type: MetadataType, details: TmdbDetailsResult): string | null {
    if (type === MetadataType.movie) {
      const usEntry = details.release_dates?.results?.find((r) => r.iso_3166_1 === "US");
      if (usEntry) {
        // Type 3 = Theatrical, 4 = Digital, 5 = Physical — prefer theatrical
        const theatrical = usEntry.release_dates.find((d) => d.type === 3 && d.certification);
        if (theatrical?.certification) return theatrical.certification;
        const any = usEntry.release_dates.find((d) => d.certification);
        if (any?.certification) return any.certification;
      }
      return null;
    }
    // TV
    const usEntry = details.content_ratings?.results?.find((r) => r.iso_3166_1 === "US");
    return usEntry?.rating ?? null;
  }

  private toMetadataPayload(type: MetadataType, result: TmdbSearchResult, imdbId: string): MetadataPayload {
    const name = (type === MetadataType.movie ? result.title : result.name)?.trim() || imdbId;
    const dateValue = type === MetadataType.movie ? result.release_date : result.first_air_date;
    const genres = (result.genre_ids ?? [])
      .map((id) => TMDB_GENRE_MAP[id])
      .filter((g): g is string => !!g);

    return {
      imdbId,
      type,
      tmdbId: result.id ?? null,
      name,
      year: this.extractYear(dateValue),
      poster: this.buildImageUrl(result.poster_path),
      background: this.buildImageUrl(result.backdrop_path),
      description: result.overview?.trim() || null,
      genres,
      rating: typeof result.vote_average === "number" ? Math.round(result.vote_average * 10) / 10 : null,
      voteCount: typeof result.vote_count === "number" ? result.vote_count : null,
      totalSeasons: null,
      totalEpisodes: null,
      runtime: null,
      certification: null,
      status: null,
      network: null,
      releaseDate: dateValue ?? null,
    };
  }

  private toMetadataPayloadFromDetails(type: MetadataType, result: TmdbDetailsResult, imdbId: string): MetadataPayload {
    const name = (type === MetadataType.movie ? result.title : result.name)?.trim() || imdbId;
    const dateValue = type === MetadataType.movie ? result.release_date : result.first_air_date;
    const genres = (result.genres ?? []).map((g) => g.name).filter(Boolean);

    const runtime = type === MetadataType.movie
      ? (typeof result.runtime === "number" && result.runtime > 0 ? result.runtime : null)
      : (result.episode_run_time?.[0] ?? null);

    const network = type === MetadataType.series
      ? (result.networks?.[0]?.name ?? null)
      : null;

    return {
      imdbId,
      type,
      tmdbId: result.id ?? null,
      name,
      year: this.extractYear(dateValue),
      poster: this.buildImageUrl(result.poster_path),
      background: this.buildImageUrl(result.backdrop_path),
      description: result.overview?.trim() || null,
      genres,
      rating: typeof result.vote_average === "number" ? Math.round(result.vote_average * 10) / 10 : null,
      voteCount: typeof result.vote_count === "number" ? result.vote_count : null,
      totalSeasons: type === MetadataType.series && typeof result.number_of_seasons === "number" ? result.number_of_seasons : null,
      totalEpisodes: type === MetadataType.series && typeof result.number_of_episodes === "number" ? result.number_of_episodes : null,
      runtime,
      certification: this.parseCertification(type, result),
      status: result.status ?? null,
      network,
      releaseDate: dateValue ?? null,
    };
  }

  private extractYear(rawDate: string | undefined) {
    if (!rawDate) {
      return null;
    }

    const parsed = new Date(rawDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear();
  }

  private buildImageUrl(path: string | null | undefined) {
    if (!path) {
      return null;
    }

    return `${TmdbClient.imageBaseUrl}${path}`;
  }

  private toMediaType(type: MetadataType): TmdbMediaType {
    if (type === MetadataType.movie) {
      return "movie";
    }

    return "tv";
  }

  private async request<T>(path: string, searchParams?: Record<string, string>): Promise<T> {
    const url = new URL(`${TmdbClient.baseUrl}${path}`);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("language", this.language);

    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`TMDB request failed (${response.status})`);
    }

    return (await response.json()) as T;
  }
}
