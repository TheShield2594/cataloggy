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
 * The line under the title in the hero: what the title *is*, as facts.
 *
 * The header used to spend nine chips in five colour treatments on this before
 * the reader reached the overview, with nothing saying which value mattered and
 * a lone genre chip stranded on its own line once the row wrapped. These are
 * facts rather than signals, so they read as text that wraps like text.
 *
 * Genres collapse into one segment, comma-separated, so a list of three doesn't
 * read as three more unrelated facts. Capped at three: past that the line is
 * longer than the title above it.
 *
 * The certification left this line for a bordered badge at the end of the row.
 * It is the one member that isn't a fact about the work — it is a classification
 * *of* it, awarded by a body, and it is the thing a reader scans this row for
 * when they are deciding whether to put it on in a room with other people. Set
 * as running text between the year and the network it read as neither.
 */
export const META_LINE_GENRE_LIMIT = 3;

// `?: T | undefined` rather than `?: T`: every caller forwards a value that is
// already optional, and a missing prop and an undefined one are the same thing
// to React and to everything below. The distinction the flag exists for is
// made where it is real — a Prisma `data`, a `fetch` init, a Fastify option.
export function buildMetaLine(item: {
  year?: number | null | undefined;
  network?: string | null | undefined;
  genres?: string[] | null | undefined;
}): string[] {
  const genres = (item.genres ?? []).filter((g) => g.trim().length > 0);
  return [
    item.year ? String(item.year) : null,
    item.network?.trim() || null,
    genres.length > 0 ? genres.slice(0, META_LINE_GENRE_LIMIT).join(", ") : null,
  ].filter((part): part is string => Boolean(part));
}

export type WatchLogTarget =
  | { kind: "movie"; imdbId: string; releaseDate: string | null | undefined }
  | { kind: "episode"; seriesImdbId: string; season: number; episode: number };

/**
 * The episode the panel's primary action offers — "Continue · S2 E5".
 *
 * The next one after the most recent watch, rolling into the following season
 * when that season is finished. A show with no history at all starts at S1 E1,
 * which is the honest answer to "what do I put on" rather than a refusal.
 *
 * Extracted from the click handler that used to compute it inline, because the
 * button now has to *say* which episode it means before it is pressed. One
 * function, so the label and what the label does cannot disagree — which is the
 * failure this shape exists to prevent, not a hypothetical: a label naming an
 * episode and a modal opening on a different one is worse than no label.
 *
 * `history` is expected newest-first, as the API returns it.
 */
export function nextEpisodeUp(
  history: { season?: number | null | undefined; episode?: number | null | undefined }[],
  seasons: { seasonNumber: number; episodeCount: number }[]
): { season: number; episode: number } {
  const lastEvent = history.find((e) => e.season != null && e.episode != null);
  if (!lastEvent) return { season: 1, episode: 1 };

  const season = lastEvent.season ?? 1;
  const episode = lastEvent.episode ?? 0;
  const watchedSeason = seasons.find((s) => s.seasonNumber === season);

  // Mid-season, or a season whose length we don't know — the next number up is
  // the best answer either way, and inventing a rollover from a length we were
  // never told is how a show lands on an episode that doesn't exist.
  if (!watchedSeason || episode < watchedSeason.episodeCount) {
    return { season, episode: episode + 1 };
  }

  const upcoming = seasons
    .filter((s) => s.seasonNumber > season && s.episodeCount > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)[0];
  if (upcoming) return { season: upcoming.seasonNumber, episode: 1 };

  // Watched to the end of the last season there is. Offering episode N+1 of
  // nothing is worse than offering the finale again — the viewer can see it is
  // the finale, and a rewatch is a thing people do.
  return { season, episode: watchedSeason.episodeCount };
}
