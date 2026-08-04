import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import type { CatalogList, ListItemWithMeta } from "../api";
import { ToastProvider } from "../hooks/useToast";
import { ListsPage } from "./ListsPage";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      getLists: vi.fn(),
      getListItems: vi.fn(),
      createList: vi.fn(),
      deleteList: vi.fn(),
      renameList: vi.fn(),
      addToList: vi.fn(),
      removeFromList: vi.fn(),
      search: vi.fn(),
    },
  };
});

// The panel fetches metadata and history of its own the moment an item opens;
// none of that is what this file is about.
vi.mock("../components/MediaDetailPanel", () => ({
  DetailPanel: () => null,
  useDetailPanel: () => ({
    selectedItem: null,
    setSelectedItem: vi.fn(),
    panelHistory: [],
    setPanelHistory: vi.fn(),
    panelHistoryLoading: false,
  }),
}));

const { api } = await import("../api");
const getLists = vi.mocked(api.getLists);
const getListItems = vi.mocked(api.getListItems);

const WATCHLIST: CatalogList = { id: "l-watch", name: "Watchlist", kind: "watchlist", itemCount: 1 };
const SCIFI: CatalogList = { id: "l-scifi", name: "Sci-Fi Night", kind: "custom", itemCount: 1 };

function itemIn(list: CatalogList, name: string): ListItemWithMeta {
  return {
    listId: list.id,
    type: "movie",
    imdbId: `tt-${name.toLowerCase()}`,
    addedAt: "2026-01-01T00:00:00.000Z",
    title: name,
    metadata: { name, poster: null, year: 2001, genres: [], rating: null },
  };
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="search">{location.search}</p>
      <button type="button" onClick={() => navigate(-1)}>history back</button>
    </>
  );
}

function renderPage(initialEntry = "/lists") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <Routes>
          <Route
            path="/lists"
            element={
              <>
                <ListsPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

const currentSearch = () => screen.getByTestId("search").textContent;

beforeEach(() => {
  getLists.mockResolvedValue({ lists: [WATCHLIST, SCIFI] });
  getListItems.mockImplementation(async (listId: string) => ({
    items: listId === WATCHLIST.id ? [itemIn(WATCHLIST, "Alien")] : [itemIn(SCIFI, "Solaris")],
  }));
});

describe("ListsPage selection in the URL", () => {
  it("names the defaulted first list in the URL", async () => {
    renderPage();

    await waitFor(() => expect(currentSearch()).toBe(`?list=${WATCHLIST.id}`));
    expect(await screen.findByText("Alien")).toBeInTheDocument();
  });

  it("opens the list named in the URL rather than the first one", async () => {
    renderPage(`/lists?list=${SCIFI.id}`);

    expect(await screen.findByText("Solaris")).toBeInTheDocument();
    expect(screen.queryByText("Alien")).not.toBeInTheDocument();
    expect(currentSearch()).toBe(`?list=${SCIFI.id}`);
  });

  it("puts a list switch in history, so Back undoes it", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(currentSearch()).toBe(`?list=${WATCHLIST.id}`));

    // Anchored: the row's delete button is also named after the list.
    await user.click(screen.getByRole("button", { name: /^sci-fi night/i }));
    await waitFor(() => expect(currentSearch()).toBe(`?list=${SCIFI.id}`));
    expect(await screen.findByText("Solaris")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /history back/i }));

    // Back lands on the previous list, not off the page — the default that put
    // the first list in the URL replaced its entry instead of pushing one.
    await waitFor(() => expect(currentSearch()).toBe(`?list=${WATCHLIST.id}`));
    expect(await screen.findByText("Alien")).toBeInTheDocument();
  });

  it("says so when the link points at a list that is gone", async () => {
    renderPage("/lists?list=l-deleted");

    expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument();
    // Nothing was fetched for an ID the sidebar doesn't know.
    expect(getListItems).not.toHaveBeenCalled();
    expect(currentSearch()).toBe("?list=l-deleted");
  });
});
