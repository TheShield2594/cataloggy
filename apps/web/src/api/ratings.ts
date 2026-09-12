/**
 * Ratings, which a title can carry as a whole, per season or per episode.
 */

import { request } from "./client";
import type {
  RatingTarget,
  RatingType,
  UserRating,
} from "./types";

/**
 * Only season and episode ratings carry the numbers that locate them; sending
 * them for a movie or series rating would be noise the API pins to 0 anyway.
 */
const ratingTarget = (type: RatingType, target?: RatingTarget) =>
  type === "season"
    ? { season: target?.season ?? 0 }
    : type === "episode"
      ? { season: target?.season ?? 0, episode: target?.episode ?? 0 }
      : {};

const ratingQuery = (type: RatingType, target?: RatingTarget) => {
  const params = new URLSearchParams(
    Object.entries(ratingTarget(type, target)).map(([k, v]) => [k, String(v)])
  );
  const query = params.toString();
  return query ? `?${query}` : "";
};

export const ratingsApi = {
  // Ratings
  setRating(imdbId: string, type: RatingType, rating: number, target?: RatingTarget) {
    return request<{ rating: UserRating }>("/ratings", {
      method: "POST",
      body: JSON.stringify({ imdbId, type, rating, ...ratingTarget(type, target) }),
    });
  },
  getRating(type: RatingType, imdbId: string, target?: RatingTarget) {
    return request<{ rating: UserRating }>(
      `/ratings/${type}/${encodeURIComponent(imdbId)}${ratingQuery(type, target)}`
    );
  },
  deleteRating(type: RatingType, imdbId: string, target?: RatingTarget) {
    return request<void>(`/ratings/${type}/${encodeURIComponent(imdbId)}${ratingQuery(type, target)}`, {
      method: "DELETE",
    });
  },
  getAllRatings(type?: RatingType | undefined, limit = 50) {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    params.set("limit", String(limit));
    return request<{ ratings: UserRating[] }>(`/ratings?${params}`);
  },
  /**
   * Every rating recorded against one title — the series itself, its seasons
   * and its episodes — in a single request, so the seasons panel doesn't fire
   * one per row.
   */
  getTitleRatings(imdbId: string) {
    return request<{ ratings: UserRating[] }>(`/ratings?imdbId=${encodeURIComponent(imdbId)}`);
  },
};
