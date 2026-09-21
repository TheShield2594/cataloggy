import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CheckIn } from "../../api";
import { NowWatchingHero } from "./NowWatchingHero";

/*
 * DashboardPage only ever renders this component from an active check-in, and
 * its page tests mock `getCheckin` with `checkin: null` — so neither branch of
 * NowWatchingHero is exercised there. A regression that always rendered the
 * flat panel would pass those tests. These cover the two branches directly.
 */

const checkin: CheckIn = {
  type: "episode",
  imdbId: "tt0903747",
  name: "Breaking Bad",
  poster: "https://image.tmdb.org/t/p/w500/p.jpg",
  season: 2,
  episode: 5,
  startedAt: "2026-09-21T00:00:00Z",
};

/** The decorative full-bleed backdrop, not the poster in the card's corner. */
const backdropOf = (container: HTMLElement) =>
  container.querySelector('img[aria-hidden="true"]');
// The bottom-up cinematic scrim (see HERO_SCRIM), painted only over a backdrop.
const scrimOf = (container: HTMLElement) =>
  container.querySelector('div[style*="linear-gradient(to top"]');

describe("NowWatchingHero", () => {
  const renderHero = (overrides: Partial<CheckIn> = {}) =>
    render(<NowWatchingHero checkin={{ ...checkin, ...overrides }} onCheckout={vi.fn()} />);

  it("wears the cinematic treatment when there is a backdrop to wear it over", () => {
    const { container } = renderHero({ background: "https://image.tmdb.org/t/p/w500/bd.jpg" });

    expect(backdropOf(container)).toHaveAttribute("src", "https://image.tmdb.org/t/p/w500/bd.jpg");
    expect(scrimOf(container)).toBeInTheDocument();
  });

  it("is a flat panel when there is no backdrop, rather than a scrim over nothing", () => {
    const { container } = renderHero({ background: undefined });

    expect(backdropOf(container)).toBeNull();
    expect(scrimOf(container)).toBeNull();
  });
});
