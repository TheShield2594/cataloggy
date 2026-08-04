import type { SearchResult } from "../api";

// The API's `all` search is two provider queries, so every surface offering an
// "All" filter has to decide how to interleave them. Doing that per-surface is
// how the search page and the add-to-list modal drifted apart in the first
// place; this is the one answer both of them use.

// How closely a result's title matches the raw query, as a coarse relevance tier.
// Exact hit > prefix > word-start > substring > no title hit.
function titleMatchScore(name: string, query: string): number {
  const n = name.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  if (n === q) return 4;
  if (n.startsWith(q)) return 3;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}`).test(n)) return 2;
  if (n.includes(q)) return 1;
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
  const tagged = [
    ...movies.map((r, rank) => ({ r, rank, order: 0 })),
    ...series.map((r, rank) => ({ r, rank, order: 1 })),
  ];
  tagged.sort((a, b) => {
    const scoreDiff = titleMatchScore(b.r.name, query) - titleMatchScore(a.r.name, query);
    if (scoreDiff !== 0) return scoreDiff;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.order - b.order;
  });
  return tagged.map((t) => t.r);
}
