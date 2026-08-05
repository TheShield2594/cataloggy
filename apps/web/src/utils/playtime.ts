/**
 * Steam reports playtime in minutes; the grid and the detail panel both show it
 * in hours, and used to round it two different ways in two different copies of
 * this function.
 *
 * A decimal only where it says something: `8.5h` earns its point, `8.0h` just
 * made one card in a row of `87h`/`52h`/`16h` look like it had been measured
 * differently. Under an hour there is no whole number left to round to, so it
 * switches to minutes rather than showing `0.5h`.
 */
export function formatPlaytime(minutes: number, unplayedLabel = "Unplayed"): string {
  if (minutes <= 0) return unplayedLabel;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10}h`;
}
