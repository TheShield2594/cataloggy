export function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Paint classes for a series' status badge.
 *
 * These used to be raw `-400` tints (green/rose/amber/slate), all picked
 * against a dark background — on the light theme's cream they sat at roughly
 * 2:1 and the badge was a smudge. `.status-chip` in index.css derives text,
 * fill and ring from one per-theme token instead, so each status stays legible
 * on all five themes; the unmatched case falls through to the chip's default,
 * which is --text-mute.
 */
export function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("return") || s.includes("ongoing")) return "status-chip status-chip--ok";
  if (s.includes("ended") || s.includes("cancel")) return "status-chip status-chip--bad";
  if (s.includes("production") || s.includes("planned")) return "status-chip status-chip--warn";
  return "status-chip";
}

export type WatchLogTarget =
  | { kind: "movie"; imdbId: string; releaseDate: string | null | undefined }
  | { kind: "episode"; seriesImdbId: string; season: number; episode: number };
