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
