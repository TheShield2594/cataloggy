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
};

type TmdbExternalIds = {
  imdb_id?: string | null;
};

type TmdbSearchResponse = {
  results?: TmdbSearchResult[];
};

type TmdbDetailsResponse = TmdbSearchResult;

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

    return this.toMetadataPayload(type, details, imdbId);
  }

  private async getExternalIds(mediaType: TmdbMediaType, tmdbId: number) {
    return this.request<TmdbExternalIds>(`/${mediaType}/${tmdbId}/external_ids`);
  }

  private toMetadataPayload(type: MetadataType, result: TmdbSearchResult, imdbId: string): MetadataPayload {
    const name = (type === MetadataType.movie ? result.title : result.name)?.trim() || imdbId;
    const dateValue = type === MetadataType.movie ? result.release_date : result.first_air_date;

    return {
      imdbId,
      type,
      tmdbId: result.id ?? null,
      name,
      year: this.extractYear(dateValue),
      poster: this.buildImageUrl(result.poster_path),
      background: this.buildImageUrl(result.backdrop_path),
      description: result.overview?.trim() || null
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
