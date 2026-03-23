import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type FilterType = "all" | "movie" | "series";
export type SortOption = "relevance" | "rating" | "year_desc" | "year_asc" | "title";
export type RuntimeBucket = "" | "short" | "medium" | "long" | "epic";

export type SearchFilters = {
  query: string;
  filter: FilterType;
  genre: string;
  yearMin: string;
  yearMax: string;
  ratingMin: string;
  provider: string;
  runtime: RuntimeBucket;
  sort: SortOption;
};

const DEFAULTS: SearchFilters = {
  query: "",
  filter: "all",
  genre: "",
  yearMin: "",
  yearMax: "",
  ratingMin: "",
  provider: "",
  runtime: "",
  sort: "relevance",
};

const VALID_FILTERS: FilterType[] = ["all", "movie", "series"];
const VALID_SORTS: SortOption[] = ["relevance", "rating", "year_desc", "year_asc", "title"];
const VALID_RUNTIMES: RuntimeBucket[] = ["", "short", "medium", "long", "epic"];

export const RUNTIME_LABELS: Record<RuntimeBucket, string> = {
  "": "Any",
  short: "< 60 min",
  medium: "60–120 min",
  long: "120–180 min",
  epic: "180+ min",
};

export const SORT_LABELS: Record<SortOption, string> = {
  relevance: "Relevance",
  rating: "Highest Rated",
  year_desc: "Newest First",
  year_asc: "Oldest First",
  title: "Title A–Z",
};

export const GENRE_OPTIONS = [
  "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary",
  "Drama", "Family", "Fantasy", "History", "Horror", "Music",
  "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western",
];

const PARAM_MAP: Record<keyof SearchFilters, string> = {
  query: "q",
  filter: "filter",
  genre: "genre",
  yearMin: "yearMin",
  yearMax: "yearMax",
  ratingMin: "ratingMin",
  provider: "provider",
  runtime: "runtime",
  sort: "sort",
};

function parseParams(params: URLSearchParams): SearchFilters {
  const f = params.get("filter") as FilterType;
  const s = params.get("sort") as SortOption;
  const r = params.get("runtime") as RuntimeBucket;
  return {
    query: params.get("q") ?? DEFAULTS.query,
    filter: VALID_FILTERS.includes(f) ? f : DEFAULTS.filter,
    genre: params.get("genre") ?? DEFAULTS.genre,
    yearMin: numericParam(params.get("yearMin"), DEFAULTS.yearMin),
    yearMax: numericParam(params.get("yearMax"), DEFAULTS.yearMax),
    ratingMin: numericParam(params.get("ratingMin"), DEFAULTS.ratingMin),
    provider: params.get("provider") ?? DEFAULTS.provider,
    runtime: VALID_RUNTIMES.includes(r) ? r : DEFAULTS.runtime,
    sort: VALID_SORTS.includes(s) ? s : DEFAULTS.sort,
  };
}

/** Return the string if it parses as a finite number, otherwise fallback. */
function numericParam(raw: string | null, fallback: string): string {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? raw : fallback;
}

export function useSearchFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: SearchFilters = useMemo(() => parseParams(searchParams), [searchParams]);

  const setFilters = useCallback(
    (updates: Partial<SearchFilters>) => {
      setSearchParams((prev) => {
        // Derive base state from prev (not the captured filters closure)
        // so back-to-back calls within the same render cycle don't lose updates.
        const base = parseParams(prev);
        const merged = { ...base, ...updates };

        const next = new URLSearchParams();

        for (const [key, paramName] of Object.entries(PARAM_MAP)) {
          const val = merged[key as keyof SearchFilters];
          const def = DEFAULTS[key as keyof SearchFilters];
          if (val && val !== def) {
            next.set(paramName, val);
          } else {
            next.delete(paramName);
          }
        }

        return next;
      }, { replace: true });
    },
    [setSearchParams]
  );

  const clearFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      // Keep query and media type filter
      for (const key of [...next.keys()]) {
        if (key !== "q" && key !== "filter") next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const hasActiveFilters = useMemo(() => {
    return (
      filters.genre !== DEFAULTS.genre ||
      filters.yearMin !== DEFAULTS.yearMin ||
      filters.yearMax !== DEFAULTS.yearMax ||
      filters.ratingMin !== DEFAULTS.ratingMin ||
      filters.sort !== DEFAULTS.sort
    );
  }, [filters]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.genre) count++;
    if (filters.yearMin || filters.yearMax) count++;
    if (filters.ratingMin) count++;
    if (filters.sort !== "relevance") count++;
    return count;
  }, [filters]);

  return { filters, setFilters, clearFilters, hasActiveFilters, activeFilterCount };
}
