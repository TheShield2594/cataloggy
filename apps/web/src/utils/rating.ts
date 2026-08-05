/**
 * Every rating the app stores or shows sits on the same 1-10 scale: the star
 * pickers in both detail panels are labelled "(1-10)", the API rejects a game
 * rating outside 1-10, and TMDB's own scores are out of ten.
 *
 * The compact places — poster chips, card metadata rows — used to print the
 * bare number next to a star, which is the one glyph that reads as "out of
 * five". A 4.8 game then looked like a near-perfect score sitting beside a
 * 4.5 film that means the opposite. Print the denominator anywhere it fits,
 * and put it in the accessible name where it doesn't.
 */
export const RATING_MAX = 10;

/** `8.4`, `8` — one decimal, and no trailing `.0` to make a whole number look measured. */
export function formatRating(rating: number): string {
  return String(Math.round(rating * 10) / 10);
}

/** `Rated 8.4 out of 10` — for chips too small to carry the suffix visually. */
export function ratingLabel(rating: number): string {
  return `Rated ${formatRating(rating)} out of ${RATING_MAX}`;
}

/**
 * Ratings the user sets are shown as five stars, half a star at a time.
 *
 * They are still *stored* on the 1-10 scale above, and deliberately so: Trakt,
 * IMDb and TMDB all rate out of ten, and collapsing to five whole stars at
 * import time would quietly merge every 9 with every 10. Five stars in half
 * steps is the same ten values wearing a different face — the mapping is
 * exactly `stored / 2`, so nothing rounds and nothing is lost in either
 * direction. External scores keep their own scale: an IMDb 8.4 is out of ten
 * and is labelled as such.
 */
export const STARS_MAX = 5;

/** Stored 1-10 → stars out of 5. `9` → `4.5`. */
export function toStars(rating: number): number {
  return rating / 2;
}

/** Stars out of 5 → stored 1-10. `4.5` → `9`. */
export function fromStars(stars: number): number {
  return Math.round(stars * 2);
}

/** `4.5`, `4` — no trailing `.0`, so a whole number doesn't look measured. */
export function formatStars(rating: number): string {
  return String(Math.round(toStars(rating) * 10) / 10);
}

/** `Rated 4.5 out of 5` — for star rows and chips that can't carry the suffix. */
export function starsLabel(rating: number): string {
  return `Rated ${formatStars(rating)} out of ${STARS_MAX}`;
}
