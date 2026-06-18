export function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("return") || s.includes("ongoing")) return "text-green-400 bg-green-500/10 ring-green-500/20";
  if (s.includes("ended") || s.includes("cancel")) return "text-rose-400 bg-rose-500/10 ring-rose-500/20";
  if (s.includes("production") || s.includes("planned")) return "text-amber-400 bg-amber-500/10 ring-amber-500/20";
  return "text-ink-600 bg-ink-100 ring-ink-200";
}

export type WatchLogTarget =
  | { kind: "movie"; imdbId: string; releaseDate: string | null | undefined }
  | { kind: "episode"; seriesImdbId: string; season: number; episode: number };
