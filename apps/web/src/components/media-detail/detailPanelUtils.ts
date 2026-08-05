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

/**
 * The detail panel header's demoted metadata, as one line.
 *
 * The header used to spend nine chips in five colour treatments on this before
 * the reader reached the overview, with nothing saying which value mattered and
 * a lone genre chip stranded on its own line once the row wrapped. Only the
 * score and the runtime are promoted now; year, certification, network and
 * genres are facts rather than signals, so they read as text that wraps like
 * text.
 *
 * Genres collapse into one segment, comma-separated, so a list of three doesn't
 * read as three more unrelated facts. Capped at three: past that the line is
 * longer than the title above it.
 */
export const META_LINE_GENRE_LIMIT = 3;

export function buildMetaLine(item: {
  year?: number | null;
  certification?: string | null;
  network?: string | null;
  genres?: string[] | null;
}): string[] {
  const genres = (item.genres ?? []).filter((g) => g.trim().length > 0);
  return [
    item.year ? String(item.year) : null,
    item.certification?.trim() || null,
    item.network?.trim() || null,
    genres.length > 0 ? genres.slice(0, META_LINE_GENRE_LIMIT).join(", ") : null,
  ].filter((part): part is string => Boolean(part));
}

export type WatchLogTarget =
  | { kind: "movie"; imdbId: string; releaseDate: string | null | undefined }
  | { kind: "episode"; seriesImdbId: string; season: number; episode: number };
