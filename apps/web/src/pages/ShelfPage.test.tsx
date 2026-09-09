import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { CatalogList, Game, ListItemWithMeta, SeriesProgress } from "../api";
import { ToastProvider } from "../hooks/useToast";
import { ShelfPage } from "./ShelfPage";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      getLists: vi.fn(),
      getListItems: vi.fn(),
      listGames: vi.fn(),
      getSeriesProgress: vi.fn(),
      getCheckin: vi.fn(),
      getWatchHistory: vi.fn(),
      markNextEpisodeWatched: vi.fn(),
    },
  };
});

// Both panels have their own suites' worth of behaviour; this file is about the
// page that opens them.
vi.mock("../components/MediaDetailPanel", async () => ({
  useDetailPanel: (await import("../components/media-detail/useDetailPanel")).useDetailPanel,
  DetailPanel: ({ item }: { item: { name: string } }) => <p>Detail panel: {item.name}</p>,
}));
vi.mock("../components/GameDetailPanel", () => ({
  GameDetailPanel: ({ game }: { game: Game }) => <p>Game panel: {game.title}</p>,
}));

const { api } = await import("../api");
const getLists = vi.mocked(api.getLists);
const getListItems = vi.mocked(api.getListItems);
const listGames = vi.mocked(api.listGames);
const getSeriesProgress = vi.mocked(api.getSeriesProgress);
const getCheckin = vi.mocked(api.getCheckin);
const getWatchHistory = vi.mocked(api.getWatchHistory);
const markNextEpisodeWatched = vi.mocked(api.markNextEpisodeWatched);

const list = (id: string, name: string): CatalogList => ({ id, name, kind: "custom", itemCount: 1 });

const item = (imdbId: string, name: string, over: Partial<ListItemWithMeta> = {}): ListItemWithMeta => ({
  listId: "l1",
  type: "movie",
  imdbId,
  addedAt: "2026-03-01T00:00:00.000Z",
  metadata: { name, poster: null, year: 2019, genres: [], rating: null },
  ...over,
});

const game = (title: string, over: Partial<Game> = {}): Game => ({
  id: `g-${title}`,
  igdbId: null,
  steamAppId: null,
  title,
  coverUrl: null,
  releaseDate: null,
  genres: [],
  playtimeMinutes: 0,
  lastPlayedAt: null,
  rating: null,
  notes: null,
  finished: false,
  finishedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const series = (over: Partial<SeriesProgress> = {}): SeriesProgress => ({
  imdbId: "tt9",
  name: "The Long Shore",
  lastSeason: 3,
  lastEpisode: 3,
  nextSeason: 3,
  nextEpisode: 4,
  seasonWatchedEpisodes: 3,
  seasonTotalEpisodes: 8,
  ...over,
});

function renderShelf(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ShelfPage />
      </ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  getLists.mockResolvedValue({ lists: [list("l1", "Watchlist")] });
  getListItems.mockResolvedValue({ items: [] });
  listGames.mockResolvedValue([]);
  getSeriesProgress.mockResolvedValue([]);
  getCheckin.mockResolvedValue({ checkin: null });
  getWatchHistory.mockResolvedValue([]);
});

describe("ShelfPage", () => {
  it("puts shows, films and games in one grid rather than three destinations", async () => {
    getListItems.mockResolvedValue({
      items: [item("tt1", "Understudy"), item("tt2", "Cold Harbour", { type: "series" })],
    });
    listGames.mockResolvedValue([game("Terra Nine")]);
    renderShelf();

    for (const title of ["Understudy", "Cold Harbour", "Terra Nine"]) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
  });

  it("collects the union of every list, not just the one that happens to be selected", async () => {
    getLists.mockResolvedValue({ lists: [list("l1", "Watchlist"), list("l2", "Rewatch")] });
    getListItems.mockImplementation(async (listId: string) => ({
      items: listId === "l1" ? [item("tt1", "Understudy")] : [item("tt2", "Nightjar")],
    }));
    renderShelf();

    expect(await screen.findByText("Understudy")).toBeInTheDocument();
    expect(screen.getByText("Nightjar")).toBeInTheDocument();
  });

  it("keeps the grid up when one list fails, rather than emptying the shelf", async () => {
    getLists.mockResolvedValue({ lists: [list("l1", "Watchlist"), list("l2", "Broken")] });
    getListItems.mockImplementation(async (listId: string) => {
      if (listId === "l2") throw new Error("nope");
      return { items: [item("tt1", "Understudy")] };
    });
    renderShelf();

    expect(await screen.findByText("Understudy")).toBeInTheDocument();
  });

  it("counts each kind on the filter row, so the buttons say what they would show", async () => {
    getListItems.mockResolvedValue({
      items: [item("tt1", "Understudy"), item("tt2", "Cold Harbour", { type: "series" })],
    });
    listGames.mockResolvedValue([game("Terra Nine")]);
    renderShelf();

    const filters = within(await screen.findByRole("group", { name: "Filter the shelf by kind" })).getAllByRole("button");
    expect(filters.map((button) => button.textContent)).toEqual(["All3", "Shows1", "Films1", "Games1"]);
  });

  /*
   * The filter row is a group of toggle buttons rather than a `tablist`: it has
   * no roving tabindex, no arrow-key navigation and no single panel to control,
   * and the Settings page's tab strip — which has all three — is the standard
   * this repo holds the role to.
   */
  it("says which filter is on with aria-pressed, not with a role it doesn't honour", async () => {
    const user = userEvent.setup();
    getListItems.mockResolvedValue({ items: [item("tt1", "Understudy")] });
    listGames.mockResolvedValue([game("Terra Nine")]);
    renderShelf();

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(await screen.findByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /^Games/ }));

    expect(screen.getByRole("button", { name: /^Games/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "false");
  });

  /*
   * The in-progress feed is series progress, not list membership, so a show
   * watched through a webhook and never added to a list lives only in the block
   * at the top. Counting the grid alone left the Shows filter reading 0 —
   * and disabled — with shows visible above it.
   */
  it("counts what is on the page, including a show that is in no list", async () => {
    getListItems.mockResolvedValue({ items: [item("tt1", "Understudy")] });
    getSeriesProgress.mockResolvedValue([series()]);
    renderShelf();

    await screen.findByText("The Long Shore");
    expect(screen.getByRole("button", { name: /^Shows/ })).toHaveTextContent("Shows1");
    expect(screen.getByRole("button", { name: /^Shows/ })).toBeEnabled();
    expect(screen.getByText("2 titles · 2 kinds")).toBeInTheDocument();
  });

  it("narrows the grid to one kind, and says so in the URL so the view can be linked", async () => {
    const user = userEvent.setup();
    getListItems.mockResolvedValue({ items: [item("tt1", "Understudy")] });
    listGames.mockResolvedValue([game("Terra Nine")]);
    renderShelf();

    await user.click(await screen.findByRole("button", { name: /^Games/ }));

    expect(screen.queryByText("Understudy")).not.toBeInTheDocument();
    expect(screen.getByText("Terra Nine")).toBeInTheDocument();
  });

  it("opens on the kind the URL names", async () => {
    getListItems.mockResolvedValue({ items: [item("tt1", "Understudy")] });
    listGames.mockResolvedValue([game("Terra Nine")]);
    renderShelf("/?kind=game");

    expect(await screen.findByText("Terra Nine")).toBeInTheDocument();
    expect(screen.queryByText("Understudy")).not.toBeInTheDocument();
  });

  it("disables a filter with nothing behind it instead of hiding it and moving the others", async () => {
    getListItems.mockResolvedValue({ items: [item("tt1", "Understudy")] });
    renderShelf();

    expect(await screen.findByRole("button", { name: /^Games/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Films/ })).toBeEnabled();
  });

  it("measures a show in episodes — a tick each, with the watched ones filled", async () => {
    getSeriesProgress.mockResolvedValue([series()]);
    const { container } = renderShelf();

    await screen.findByText("The Long Shore");
    // The row already writes "3/8 ep" beside the title, so the ruler is
    // decorative here and carries no role — see ProgressRuler's `decorative`.
    const ticks = container.querySelectorAll('[aria-hidden="true"] > span.flex-1');
    expect(ticks).toHaveLength(8);
    expect([...ticks].filter((tick) => (tick as HTMLElement).style.background.includes("--accent-rgb"))).toHaveLength(3);
    expect(screen.getByText("3/8 ep")).toBeInTheDocument();
  });

  it("measures a game in hours and draws it no ruler, because hours have no total", async () => {
    listGames.mockResolvedValue([game("Hollow Signal", { playtimeMinutes: 504, lastPlayedAt: "2026-09-01T00:00:00.000Z" })]);
    const { container } = renderShelf();

    expect(await screen.findByText("8.4h")).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"] > span.flex-1')).toHaveLength(0);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("does not repeat what is in progress down in the grid below it", async () => {
    getSeriesProgress.mockResolvedValue([series()]);
    renderShelf();

    await screen.findByText("In progress");
    expect(screen.getAllByText("The Long Shore")).toHaveLength(1);
  });

  it("marks the next episode from the row, then refetches — a watch moves the whole block", async () => {
    const user = userEvent.setup();
    getSeriesProgress.mockResolvedValue([series()]);
    markNextEpisodeWatched.mockResolvedValue(undefined);
    renderShelf();

    await user.click(await screen.findByRole("button", { name: /Mark S3:E4 of The Long Shore watched/i }));

    await waitFor(() => expect(markNextEpisodeWatched).toHaveBeenCalledWith("tt9"));
    await waitFor(() => expect(getSeriesProgress).toHaveBeenCalledTimes(2));
  });

  it("offers no resume button on a game, which has no next unit to mark", async () => {
    listGames.mockResolvedValue([game("Hollow Signal", { playtimeMinutes: 504 })]);
    renderShelf();

    await screen.findByText("In progress");
    expect(screen.queryByRole("button", { name: /mark/i })).toBeNull();
  });

  it("opens the media panel for a title and the game panel for a game", async () => {
    const user = userEvent.setup();
    getListItems.mockResolvedValue({ items: [item("tt1", "Understudy")] });
    listGames.mockResolvedValue([game("Terra Nine")]);
    renderShelf();

    await user.click(await screen.findByRole("button", { name: "Open details for Understudy" }));
    expect(await screen.findByText("Detail panel: Understudy")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open details for Terra Nine" }));
    expect(await screen.findByText("Game panel: Terra Nine")).toBeInTheDocument();
  });

  it("summarises the shelf in its own terms, counting only the kinds that are on it", async () => {
    getListItems.mockResolvedValue({ items: [item("tt1", "Understudy"), item("tt2", "Nightjar")] });
    renderShelf();

    expect(await screen.findByText("2 titles · 1 kind")).toBeInTheDocument();
  });

  it("offers somewhere to go rather than an empty grid when nothing is tracked yet", async () => {
    renderShelf();

    expect(await screen.findByText("Nothing on the shelf yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
    expect(screen.queryByRole("group", { name: "Filter the shelf by kind" })).toBeNull();
  });

  it("offers a retry when the shelf itself fails, rather than a blank page", async () => {
    const user = userEvent.setup();
    getLists.mockRejectedValueOnce(new Error("API down"));
    renderShelf();

    // By text rather than by role: the toast provider keeps two empty live
    // regions mounted, one of which is also role="alert".
    expect(await screen.findByText("API down")).toBeInTheDocument();

    getLists.mockResolvedValue({ lists: [list("l1", "Watchlist")] });
    getListItems.mockResolvedValue({ items: [item("tt1", "Understudy")] });
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Understudy")).toBeInTheDocument();
  });

  it("keeps a link to each surface it browses on behalf of", async () => {
    renderShelf();

    const manage = await screen.findByRole("navigation", { name: "Manage" });
    expect(within(manage).getByRole("link", { name: "Lists" })).toHaveAttribute("href", "/lists");
    expect(within(manage).getByRole("link", { name: "Games" })).toHaveAttribute("href", "/games");
    expect(within(manage).getByRole("link", { name: "History" })).toHaveAttribute("href", "/history");
  });
});
