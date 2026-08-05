import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { Game, GameSearchResult } from "../api";
import { ToastProvider } from "../hooks/useToast";
import { GamesPage } from "./GamesPage";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      listGames: vi.fn(),
      searchGames: vi.fn(),
      addGame: vi.fn(),
      getSteamStatus: vi.fn(),
      triggerSteamSync: vi.fn(),
    },
  };
});

// The panel is its own component with its own tests' worth of behaviour; this
// file is about the page that opens it.
vi.mock("../components/GameDetailPanel", () => ({
  GameDetailPanel: ({ game, onClose }: { game: Game; onClose: () => void }) => (
    <div>
      <p>Game panel: {game.title}</p>
      <button type="button" onClick={onClose}>close game panel</button>
    </div>
  ),
}));

const { api } = await import("../api");
const listGames = vi.mocked(api.listGames);
const searchGames = vi.mocked(api.searchGames);
const addGame = vi.mocked(api.addGame);
const getSteamStatus = vi.mocked(api.getSteamStatus);
const triggerSteamSync = vi.mocked(api.triggerSteamSync);

function game(title: string, over: Partial<Game> = {}): Game {
  return {
    id: `g-${title.toLowerCase().replace(/\s+/g, "-")}`,
    igdbId: 1,
    steamAppId: null,
    title,
    coverUrl: null,
    releaseDate: "2020-01-01",
    genres: ["RPG"],
    playtimeMinutes: 120,
    lastPlayedAt: "2026-01-01T00:00:00.000Z",
    rating: null,
    notes: null,
    finished: false,
    finishedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function searchHit(title: string, over: Partial<GameSearchResult> = {}): GameSearchResult {
  return {
    igdbId: title.length,
    title,
    coverUrl: null,
    releaseDate: "2020-01-01",
    genres: ["RPG"],
    inLibrary: false,
    ...over,
  };
}

const HADES = game("Hades", { playtimeMinutes: 600 });
const OUTER_WILDS = game("Outer Wilds", { playtimeMinutes: 60 });

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="search-params">{location.search}</p>;
}

function renderPage(initialEntry = "/games") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <Routes>
          <Route
            path="/games"
            element={
              <>
                <GamesPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  listGames.mockResolvedValue([HADES, OUTER_WILDS]);
  searchGames.mockResolvedValue([]);
  getSteamStatus.mockResolvedValue({ configured: false, player: null });
});

describe("GamesPage library", () => {
  it("lists the library it loaded", async () => {
    renderPage();

    expect(await screen.findByText("Hades")).toBeInTheDocument();
    expect(screen.getByText("Outer Wilds")).toBeInTheDocument();
    expect(listGames).toHaveBeenCalledWith("recent", expect.any(AbortSignal));
  });

  it("puts the sort in the URL and asks the server for it", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Hades");

    await user.click(screen.getByRole("button", { name: "Playtime" }));

    await waitFor(() => expect(screen.getByTestId("search-params").textContent).toBe("?sort=playtime"));
    // Sorting is the server's answer, not a client-side reshuffle of one page.
    expect(listGames).toHaveBeenCalledWith("playtime", expect.any(AbortSignal));
  });

  it("opens on the sort named in the URL", async () => {
    renderPage("/games?sort=rating");

    await waitFor(() => expect(listGames).toHaveBeenCalledWith("rating", expect.any(AbortSignal)));
  });

  it("invites a first game rather than showing an empty grid", async () => {
    listGames.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/no games in your library yet/i)).toBeInTheDocument();
  });

  it("reports a failed load and doesn't claim the library is empty", async () => {
    listGames.mockRejectedValue(new Error("Games unavailable"));
    renderPage();

    expect(await screen.findByText("Games unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/no games in your library yet/i)).not.toBeInTheDocument();
  });

  it("opens the detail panel for the card clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "View details for Hades" }));

    expect(await screen.findByText("Game panel: Hades")).toBeInTheDocument();
  });
});

describe("GamesPage Steam bar", () => {
  it("stays out of the way when Steam isn't connected", async () => {
    renderPage();
    await screen.findByText("Hades");

    expect(screen.queryByRole("button", { name: /sync now/i })).not.toBeInTheDocument();
  });

  it("syncs on demand and reloads the library with what came back", async () => {
    const user = userEvent.setup();
    getSteamStatus.mockResolvedValue({
      configured: true,
      player: { steamId: "1", username: "alex", avatar: null, profileUrl: null },
    });
    triggerSteamSync.mockResolvedValue({ total: 3, created: 2, updated: 1, matched: 3, unmatched: 0 });
    renderPage();
    await screen.findByText("Hades");

    listGames.mockResolvedValue([HADES, OUTER_WILDS, game("Celeste")]);
    await user.click(screen.getByRole("button", { name: /sync now/i }));

    expect(await screen.findByText(/2 added, 1 updated/)).toBeInTheDocument();
    expect(await screen.findByText("Celeste")).toBeInTheDocument();
  });

  it("says why a sync failed", async () => {
    const user = userEvent.setup();
    getSteamStatus.mockResolvedValue({ configured: true, player: null });
    triggerSteamSync.mockRejectedValue(new Error("Steam API returned 503"));
    renderPage();
    await screen.findByText("Hades");

    await user.click(screen.getByRole("button", { name: /sync now/i }));

    expect(await screen.findByText("Steam API returned 503")).toBeInTheDocument();
  });
});

describe("GamesPage add-game modal", () => {
  const openModal = async (user: ReturnType<typeof userEvent.setup>) => {
    renderPage();
    await screen.findByText("Hades");
    await user.click(screen.getByRole("button", { name: /add game/i }));
    return within(screen.getByRole("dialog"));
  };

  it("searches IGDB once for a query typed a letter at a time", async () => {
    const user = userEvent.setup();
    const dialog = await openModal(user);

    await user.type(dialog.getByLabelText("Search games"), "celeste");

    await waitFor(() => expect(searchGames).toHaveBeenCalledWith("celeste", expect.any(AbortSignal)));
    expect(searchGames).toHaveBeenCalledTimes(1);
  });

  it("adds a result to the library and puts it in the grid", async () => {
    const user = userEvent.setup();
    searchGames.mockResolvedValue([searchHit("Celeste")]);
    addGame.mockResolvedValue({ game: game("Celeste") });
    const dialog = await openModal(user);

    await user.type(dialog.getByLabelText("Search games"), "celeste");
    await user.click(await dialog.findByRole("button", { name: /Celeste/ }));

    await waitFor(() =>
      expect(addGame).toHaveBeenCalledWith({
        igdbId: 7,
        title: "Celeste",
        coverUrl: null,
        releaseDate: "2020-01-01",
        genres: ["RPG"],
      })
    );
    expect(await screen.findByText("Added Celeste")).toBeInTheDocument();
    // Added without a reload, and only once — the row is spent.
    expect(dialog.getByRole("button", { name: /Celeste/ })).toBeDisabled();
    expect(listGames).toHaveBeenCalledTimes(1);
  });

  it("won't offer to add a game already in the library", async () => {
    const user = userEvent.setup();
    searchGames.mockResolvedValue([searchHit("Hades", { inLibrary: true })]);
    const dialog = await openModal(user);

    await user.type(dialog.getByLabelText("Search games"), "hades");

    const row = await dialog.findByRole("button", { name: /Hades/ });
    expect(row).toBeDisabled();
    await user.click(row);
    expect(addGame).not.toHaveBeenCalled();
  });

  it("says so when the search fails", async () => {
    const user = userEvent.setup();
    searchGames.mockRejectedValue(new Error("IGDB is not configured"));
    const dialog = await openModal(user);

    await user.type(dialog.getByLabelText("Search games"), "celeste");

    expect(await dialog.findByText("IGDB is not configured")).toBeInTheDocument();
    expect(dialog.queryByText(/no results found/i)).not.toBeInTheDocument();
  });

  it("says nothing matched, once the search has actually run", async () => {
    const user = userEvent.setup();
    const dialog = await openModal(user);

    await user.type(dialog.getByLabelText("Search games"), "zzzz");

    expect(await dialog.findByText(/no results found/i)).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    await openModal(user);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
