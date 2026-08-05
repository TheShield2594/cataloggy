import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SeriesProgress } from "../api";
import { ContinueWatchingCard, ContinueWatchingHero, DiscoveryCard } from "./DashboardPage";

const series: SeriesProgress = {
  imdbId: "tt0903747",
  name: "Breaking Bad",
  lastSeason: 2,
  lastEpisode: 4,
  nextSeason: 2,
  nextEpisode: 5,
  totalSeasons: 5,
  totalEpisodes: 62,
  watchedEpisodes: 20,
};

describe("DiscoveryCard", () => {
  it("offers its action as a real button rather than a div wearing the role", async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <DiscoveryCard item={{ id: "tt1", name: "Arrival" }} onSelect={onSelect} />
    );

    expect(container.querySelector('[role="button"]')).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "View details for Arrival" }));
    expect(onSelect).toHaveBeenCalledWith({ id: "tt1", name: "Arrival" });
  });

  it("is not focusable at all when there is nothing to select", () => {
    render(<DiscoveryCard item={{ id: "tt1", name: "Arrival" }} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ContinueWatchingCard", () => {
  const renderCard = (overrides: Partial<Parameters<typeof ContinueWatchingCard>[0]> = {}) => {
    const props = {
      s: series,
      eager: false,
      isMarking: false,
      isDone: false,
      onMarkNext: vi.fn(),
      onSelect: vi.fn(),
      ...overrides,
    };
    render(<ContinueWatchingCard {...props} />);
    return props;
  };

  it("announces its controls as one group named for the series", () => {
    renderCard();

    const group = screen.getByRole("group", { name: "Breaking Bad" });
    // Two, not three: the title used to be a third control opening the same
    // panel as the poster.
    expect(within(group).getAllByRole("button")).toHaveLength(2);
  });

  it("keeps 'mark next' and 'view details' as separate targets", async () => {
    const { onMarkNext, onSelect } = renderCard();

    await userEvent.click(screen.getByRole("button", { name: "Mark S2:E5" }));
    expect(onMarkNext).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "View details for Breaking Bad" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onMarkNext).toHaveBeenCalledTimes(1);
  });

  it("still shows the title, just not as something to click", () => {
    renderCard();

    expect(screen.getByText("Breaking Bad")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Breaking Bad" })).not.toBeInTheDocument();
  });

  it("pluralises a single-season show", () => {
    renderCard({ s: { ...series, totalSeasons: 1 } });

    expect(screen.getByText(/1 season(?!s)/)).toBeInTheDocument();
  });
});

describe("ContinueWatchingHero", () => {
  const renderHero = (overrides: Partial<SeriesProgress> = {}) => {
    render(
      <ContinueWatchingHero
        s={{ ...series, ...overrides }}
        isMarking={false}
        isDone={false}
        onMarkNext={vi.fn()}
        onSelect={vi.fn()}
      />
    );
  };

  it("labels the bar for the numbers filling it", () => {
    renderHero({ lastSeason: 2, seasonTotalEpisodes: 13, seasonWatchedEpisodes: 7 });

    expect(screen.getByText("Season progress")).toBeInTheDocument();
    expect(screen.getByText("7 / 13 episodes")).toBeInTheDocument();
  });

  it("says 'Series progress' when it has only series-wide totals to show", () => {
    renderHero({ seasonTotalEpisodes: null, seasonWatchedEpisodes: null });

    expect(screen.getByText("Series progress")).toBeInTheDocument();
    expect(screen.getByText("20 / 62 episodes")).toBeInTheDocument();
  });

  it("pluralises a single-season show", () => {
    renderHero({ totalSeasons: 1 });

    expect(screen.getByText(/1 season(?!s)/)).toBeInTheDocument();
  });
});
