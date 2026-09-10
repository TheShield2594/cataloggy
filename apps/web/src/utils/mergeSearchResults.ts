import type { SearchResult } from "../api";

// The API's `all` search is two provider queries, so every surface offering an
// "All" filter has to decide how to interleave them. Doing that per-surface is
// how the search page and the add-to-list modal drifted apart in the first
// place; this is the one answer both of them use.

// How closely a result's title matches the raw query, as a coarse relevance tier.
// Exact hit > prefix > word-start > substring > no title hit.
// `wordStart` is the caller's precompiled `\b<query>` matcher: building it here
// would mean a fresh RegExp per call, and the only caller scores every row.
function titleMatchScore(name: string, query: string, wordStart: RegExp): number {
  const n = name.trim().toLowerCase();
  if (!query) return 0;
  if (n === query) return 4;
  if (n.startsWith(query)) return 3;
  if (wordStart.test(n)) return 2;
  if (n.includes(query)) return 1;
  return 0;
}

// Each list arrives already in the provider's relevance order. A naive
// one-for-one interleave lets a weak series match sit above a strong movie
// match. Instead, rank by title-match tier first, then by each result's original
// per-type position, falling back to movies-before-series so equally-good
// matches still alternate the way the old interleave did.
export function mergeByRelevance(
  movies: SearchResult[],
  series: SearchResult[],
  query: string,
): SearchResult[] {
  // Score every row once up front rather than inside the comparator: a
  // comparator runs O(n log n) times, and scoring compiles nothing but still
  // walks the title three times. The `\b<query>` matcher is compiled once here
  // for the same reason — it used to be rebuilt on every comparison.
  const q = query.trim().toLowerCase();
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // No /g: a stateful regex would carry `lastIndex` between rows.
  const wordStart = new RegExp(`\\b${escaped}`);

  const tagged = [
    ...movies.map((r, rank) => ({ r, rank, order: 0 })),
    ...series.map((r, rank) => ({ r, rank, order: 1 })),
  ].map((t) => ({ ...t, score: titleMatchScore(t.r.name, q, wordStart) }));

  tagged.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.order - b.order;
  });
  return tagged.map((t) => t.r);
}
