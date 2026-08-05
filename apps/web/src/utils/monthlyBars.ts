/**
 * Geometry for one column of the Stats page's Monthly Activity chart.
 *
 * The column is a fixed-height box and the bars grow from its bottom, so a
 * value label rendered as a sibling *above* that box lands at the top of the
 * chart no matter how short its bar is — with one tall month, January's `4`
 * sat ~100px above January's 6px bar and the numbers read as a detached row of
 * digits. The label has to be positioned from the same percentage the bar is
 * drawn at, which means both have to come from one place.
 *
 * All three heights are percentages of the column, not pixels, so the column
 * can be sized in CSS without the label drifting off its bar.
 */
export type MonthlyBar = {
  /** Movies plus episodes. Zero months draw a placeholder and print no label. */
  total: number;
  /** Height of the whole stack, and therefore the label's offset from the floor. */
  height: number;
  /** The claw-tinted lower segment. */
  movieHeight: number;
  /** The plum-tinted upper segment. `height - movieHeight`, so the two always sum. */
  episodeHeight: number;
};

/**
 * A month with any activity gets at least 4% so a single watch is still a
 * visible mark rather than a hairline; an empty month gets 2%, which the chart
 * draws as a dashed placeholder instead of a bar.
 */
const MIN_BAR_HEIGHT = 4;
const EMPTY_BAR_HEIGHT = 2;

export function monthlyBarGeometry(movies: number, episodes: number, maxTotal: number): MonthlyBar {
  const total = movies + episodes;
  if (total <= 0) {
    return { total: 0, height: EMPTY_BAR_HEIGHT, movieHeight: 0, episodeHeight: 0 };
  }
  // Clamped at both ends. A 0 maximum would otherwise divide to Infinity, and
  // any maximum below the month's own total would draw a bar taller than the
  // column it lives in — taking the value label, which is positioned from this
  // same number, out of the chart with it.
  const height = Math.min(Math.max((total / Math.max(maxTotal, 1)) * 100, MIN_BAR_HEIGHT), 100);
  const movieHeight = (movies / total) * height;
  return { total, height, movieHeight, episodeHeight: height - movieHeight };
}
