import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult, WatchEvent } from "../../api";
import type { PanelDetail } from "./useDetailPanel";
import { DetailPanel } from "./DetailPanel";

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      getCheckin: vi.fn(),
      getLists: vi.fn(),
      getRating: vi.fn(),
      getItemTags: vi.fn(),
      getWatchHistory: vi.fn(),
      deleteWatchEvent: vi.fn(),
      logWatch: vi.fn(),
      dropShow: vi.fn(),
      undropShow: vi.fn(),
      getWatchedEpisodes: vi.fn(),
      getSeasonEpisodes: vi.fn(),
      getTitleRatings: vi.fn(),
    },
  };
});

const { api } = await import("../../api");
const getCheckin = vi.mocked(api.getCheckin);
const getLists = vi.mocked(api.getLists);
const getRating = vi.mocked(api.getRating);
const getItemTags = vi.mocked(api.getItemTags);
const deleteWatchEvent = vi.mocked(api.deleteWatchEvent);

const MOVIE: SearchResult = {
  imdbId: "tt-solaris",
  type: "movie",
  name: "Solaris",
  year: 1972,
  poster: null,
  description: "A psychologist is sent to a station orbiting a distant planet.",
  genres: ["Sci-Fi"],
  rating: 8.1,
  inWatchlist: false,
  inCollection: false,
  lists: [],
};

const SERIES: SearchResult = { ...MOVIE, imdbId: "tt-severance", type: "series", name: "Severance" };

const WATCH: WatchEvent = {
  id: "ev-1",
  imdbId: MOVIE.imdbId,
  type: "movie",
  name: "Solaris",
  watchedAt: "2026-01-02T20:00:00.000Z",
  dateUnknown: false,
};

const FULL_DETAIL: PanelDetail = {
  cast: [{ name: "Donatas Banionis", character: "Kris Kelvin", photo: null, order: 0 }],
  director: "Andrei Tarkovsky",
  providers: { flatrate: [{ id: 1, name: "Criterion Channel", logo: null }], free: [], ads: [], link: null },
  recommendations: [],
  seasons: [],
  dropped: false,
};

function renderPanel(over: Partial<Parameters<typeof DetailPanel>[0]> = {}) {
  const props = {
    item: MOVIE,
    history: [WATCH],
    historyLoading: false,
    detail: null as PanelDetail | null,
    detailLoading: false,
    onClose: vi.fn(),
    onShowToast: vi.fn(),
    onHistoryChange: vi.fn(),
    onSelectItem: vi.fn(),
    ...over,
  };
  return { ...render(<DetailPanel {...props} />), props };
}

beforeEach(() => {
  getCheckin.mockResolvedValue({ checkin: null });
  getLists.mockResolvedValue({ lists: [] });
  getRating.mockResolvedValue({ rating: { rating: null } } as never);
  getItemTags.mockResolvedValue({ tags: [] });
  vi.mocked(api.getWatchedEpisodes).mockResolvedValue({ episodes: [] } as never);
  vi.mocked(api.getTitleRatings).mockResolvedValue({ ratings: [] } as never);
});

// The API composes cast, providers, recommendations, seasons and dropped state
// into one bundle, and its own tests cover a section of that bundle failing
// without taking the response with it. This is the client half: a bundle that
// arrived empty, or not at all, must leave a usable panel rather than a blank one.
describe("DetailPanel section degradation", () => {
  it("still shows the title and what it knows when the bundle never arrived", async () => {
    renderPanel();

    const dialog = await screen.findByRole("dialog", { name: "Solaris" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Solaris" })).toBeInTheDocument();
    expect(screen.getByText(/psychologist is sent to a station/i)).toBeInTheDocument();
    expect(screen.getByText("Watch History")).toBeInTheDocument();
    // The bundle's own sections are simply absent — not stuck on skeletons.
    expect(screen.queryByText("Cast")).not.toBeInTheDocument();
    expect(screen.queryByText("Where to Watch")).not.toBeInTheDocument();
    expect(screen.queryByText("More Like This")).not.toBeInTheDocument();
  });

  it("draws the bundle's sections once it does arrive", async () => {
    renderPanel({ detail: FULL_DETAIL });

    expect(await screen.findByText("Donatas Banionis")).toBeInTheDocument();
    expect(screen.getByText("Criterion Channel")).toBeInTheDocument();
    expect(screen.getByText(/Andrei Tarkovsky/)).toBeInTheDocument();
  });

  it("keeps the drop button hidden while the dropped state is unknown", async () => {
    const { rerender } = renderPanel({ item: SERIES });

    await screen.findByRole("dialog", { name: "Severance" });
    // A failed bundle leaves `dropped` unknown, and defaulting it to false would
    // offer to drop a show that is already dropped.
    expect(screen.queryByRole("button", { name: /drop/i })).not.toBeInTheDocument();

    rerender(
      <DetailPanel
        item={SERIES}
        history={[]}
        historyLoading={false}
        detail={FULL_DETAIL}
        detailLoading={false}
        onClose={vi.fn()}
        onShowToast={vi.fn()}
        onHistoryChange={vi.fn()}
        onSelectItem={vi.fn()}
      />
    );

    expect(await screen.findByRole("button", { name: /drop/i })).toBeInTheDocument();
  });

  it("survives the sections that fetch for themselves failing", async () => {
    getLists.mockRejectedValue(new Error("Lists unavailable"));
    getItemTags.mockRejectedValue(new Error("Tags unavailable"));
    getCheckin.mockRejectedValue(new Error("Check-in unavailable"));
    renderPanel({ detail: FULL_DETAIL });

    expect(await screen.findByRole("heading", { name: "Solaris" })).toBeInTheDocument();
    expect(screen.getByText("Watch History")).toBeInTheDocument();
    expect(screen.getByText("Donatas Banionis")).toBeInTheDocument();
  });
});

describe("DetailPanel watch history", () => {
  it("hands the shortened history back to the page and offers the way back", async () => {
    const user = userEvent.setup();
    deleteWatchEvent.mockResolvedValue(undefined as never);
    const { props } = renderPanel();

    await user.click(await screen.findByRole("button", { name: "Remove watch of Solaris" }));

    await waitFor(() => expect(props.onHistoryChange).toHaveBeenCalledWith([]));
    expect(deleteWatchEvent).toHaveBeenCalledWith(WATCH.id);
    expect(props.onShowToast).toHaveBeenCalledWith(
      "Watch removed",
      "info",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) })
    );
  });

  it("keeps the row when the delete fails", async () => {
    const user = userEvent.setup();
    deleteWatchEvent.mockRejectedValue(new Error("nope"));
    const { props } = renderPanel();

    await user.click(await screen.findByRole("button", { name: "Remove watch of Solaris" }));

    await waitFor(() =>
      expect(props.onShowToast).toHaveBeenCalledWith("Failed to remove watch event", "error")
    );
    expect(props.onHistoryChange).not.toHaveBeenCalled();
  });
});

describe("DetailPanel dismissal", () => {
  it("closes on the close button", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(await screen.findByRole("button", { name: "Close detail panel" }));

    // Closing is animated, and jsdom runs no animations — the hook's fallback
    // timer is what closes it here, as it would in a browser that dropped the
    // animation.
    await waitFor(() => expect(props.onClose).toHaveBeenCalled(), { timeout: 1000 });
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    await screen.findByRole("dialog", { name: "Solaris" });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(props.onClose).toHaveBeenCalled(), { timeout: 1000 });
  });
});
