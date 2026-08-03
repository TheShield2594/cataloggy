import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { useSearchFilters } from "./useSearchFilters";

/** Renders the hook at `initialUrl` and exposes the resulting query string. */
function renderFilters(initialUrl = "/search") {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ ...useSearchFilters(), search: useLocation().search }), { wrapper });
}

describe("useSearchFilters", () => {
  describe("parsing the URL", () => {
    it("falls back to defaults when no params are present", () => {
      const { result } = renderFilters();
      expect(result.current.filters).toEqual({
        query: "",
        filter: "all",
        genre: "",
        yearMin: "",
        yearMax: "",
        ratingMin: "",
        sort: "relevance",
      });
    });

    it("reads every supported param", () => {
      const { result } = renderFilters(
        "/search?q=dune&filter=movie&genre=Sci-Fi&yearMin=1990&yearMax=2020&ratingMin=7&sort=rating"
      );
      expect(result.current.filters).toEqual({
        query: "dune",
        filter: "movie",
        genre: "Sci-Fi",
        yearMin: "1990",
        yearMax: "2020",
        ratingMin: "7",
        sort: "rating",
      });
    });

    it("rejects a filter or sort value outside the allowed set", () => {
      const { result } = renderFilters("/search?filter=book&sort=popularity");
      expect(result.current.filters.filter).toBe("all");
      expect(result.current.filters.sort).toBe("relevance");
    });

    it("rejects non-numeric year and rating params", () => {
      const { result } = renderFilters("/search?yearMin=abc&yearMax=2020&ratingMin=<script>");
      expect(result.current.filters.yearMin).toBe("");
      expect(result.current.filters.yearMax).toBe("2020");
      expect(result.current.filters.ratingMin).toBe("");
    });
  });

  describe("setFilters", () => {
    it("writes non-default values into the query string", () => {
      const { result } = renderFilters();

      act(() => result.current.setFilters({ query: "dune", genre: "Sci-Fi" }));

      expect(result.current.filters.query).toBe("dune");
      expect(result.current.search).toContain("q=dune");
      expect(result.current.search).toContain("genre=Sci-Fi");
    });

    it("drops params that are reset to their default", () => {
      const { result } = renderFilters("/search?q=dune&genre=Horror&sort=rating");

      act(() => result.current.setFilters({ genre: "", sort: "relevance" }));

      expect(result.current.search).toBe("?q=dune");
    });

    it("preserves params it was not asked to change", () => {
      const { result } = renderFilters("/search?q=dune&filter=movie");

      act(() => result.current.setFilters({ ratingMin: "8" }));

      expect(result.current.filters).toMatchObject({ query: "dune", filter: "movie", ratingMin: "8" });
    });

    // The updater derives its base from `prev` so it can merge onto the freshest
    // params, but react-router hands the functional form the params captured at
    // the current render — so two calls in one tick still both start from the
    // pre-navigation URL and the last one wins. Pinned here so the day
    // react-router starts passing live params, this flips and gets noticed.
    it("loses the earlier of two updates issued in the same render cycle", () => {
      const { result } = renderFilters();

      act(() => {
        result.current.setFilters({ query: "dune" });
        result.current.setFilters({ genre: "Sci-Fi" });
      });

      expect(result.current.filters.genre).toBe("Sci-Fi");
      expect(result.current.filters.query).toBe("");
    });

    it("drops unknown params that were never part of the filter state", () => {
      const { result } = renderFilters("/search?q=dune&utm_source=newsletter");

      act(() => result.current.setFilters({ genre: "Drama" }));

      expect(result.current.search).not.toContain("utm_source");
    });
  });

  describe("clearFilters", () => {
    it("keeps the query and media type but clears the rest", () => {
      const { result } = renderFilters(
        "/search?q=dune&filter=movie&genre=Sci-Fi&yearMin=1990&ratingMin=7&sort=rating"
      );

      act(() => result.current.clearFilters());

      expect(result.current.filters).toMatchObject({
        query: "dune",
        filter: "movie",
        genre: "",
        yearMin: "",
        ratingMin: "",
        sort: "relevance",
      });
    });
  });

  describe("active filter reporting", () => {
    it("reports nothing active for a bare query", () => {
      const { result } = renderFilters("/search?q=dune&filter=series");
      expect(result.current.hasActiveFilters).toBe(false);
      expect(result.current.activeFilterCount).toBe(0);
    });

    it("counts a year range as a single filter", () => {
      const { result } = renderFilters("/search?yearMin=1990&yearMax=2020");
      expect(result.current.hasActiveFilters).toBe(true);
      expect(result.current.activeFilterCount).toBe(1);
    });

    it("counts genre, year range, rating and sort separately", () => {
      const { result } = renderFilters("/search?genre=Horror&yearMin=1990&ratingMin=7&sort=title");
      expect(result.current.activeFilterCount).toBe(4);
    });
  });
});
