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
  "Mystery", "Romance", "Science Fiction", "Sci-Fi", "Thriller", "War", "Western",
];

export function useSearchFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: SearchFilters = useMemo(() => {
    const f = searchParams.get("filter") as FilterType;
    const s = searchParams.get("sort") as SortOption;
    const r = searchParams.get("runtime") as RuntimeBucket;
    return {
      query: searchParams.get("q") ?? DEFAULTS.query,
      filter: VALID_FILTERS.includes(f) ? f : DEFAULTS.filter,
      genre: searchParams.get("genre") ?? DEFAULTS.genre,
      yearMin: searchParams.get("yearMin") ?? DEFAULTS.yearMin,
      yearMax: searchParams.get("yearMax") ?? DEFAULTS.yearMax,
      ratingMin: searchParams.get("ratingMin") ?? DEFAULTS.ratingMin,
      provider: searchParams.get("provider") ?? DEFAULTS.provider,
      runtime: VALID_RUNTIMES.includes(r) ? r : DEFAULTS.runtime,
      sort: VALID_SORTS.includes(s) ? s : DEFAULTS.sort,
    };
  }, [searchParams]);

  const setFilters = useCallback(
    (updates: Partial<SearchFilters>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const merged = { ...filters, ...updates };

        // Map state keys to URL param keys
        const paramMap: Record<keyof SearchFilters, string> = {
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

        for (const [key, paramName] of Object.entries(paramMap)) {
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
    [filters, setSearchParams]
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
