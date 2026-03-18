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

export class TmdbClient {
  private static readonly baseUrl = "https://api.themoviedb.org/3";
  private static readonly imageBaseUrl = "https://image.tmdb.org/t/p/w500";

  private constructor(private readonly apiKey: string) {}

  static fromEnv() {
    const apiKey = process.env.TMDB_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("TMDB_API_KEY is not configured");
    }

    return new TmdbClient(apiKey);
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

  async findByImdbId(type: MetadataType, imdbId: string): Promise<MetadataPayload | null> {
    const findResponse = await this.request<TmdbFindResponse>(`/find/${encodeURIComponent(imdbId)}`, {
      external_source: "imdb_id"
    });

    const result = type === MetadataType.movie ? findResponse.movie_results?.[0] : findResponse.tv_results?.[0];
    if (!result?.id) {
      return null;
    }

    const mediaType = this.toMediaType(type);
    const details = await this.request<TmdbDetailsResponse>(`/${mediaType}/${result.id}`);

    return this.toMetadataPayloadFromDetails(type, details, imdbId);
  }

  private async getExternalIds(mediaType: TmdbMediaType, tmdbId: number) {
    return this.request<TmdbExternalIds>(`/${mediaType}/${tmdbId}/external_ids`);
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
    };
  }

  private toMetadataPayloadFromDetails(type: MetadataType, result: TmdbDetailsResponse, imdbId: string): MetadataPayload {
    const name = (type === MetadataType.movie ? result.title : result.name)?.trim() || imdbId;
    const dateValue = type === MetadataType.movie ? result.release_date : result.first_air_date;
    const genres = (result.genres ?? []).map((g) => g.name).filter(Boolean);

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
