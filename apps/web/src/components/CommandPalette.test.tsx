import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import type { SearchResult } from "../api";
import { ToastProvider } from "../hooks/useToast";
import { CommandPalette } from "./CommandPalette";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { search: vi.fn() } };
});

// Stubbed, but statefully: opening a result is the palette's job, and the real
// panel would go fetching a bundle, a check-in and a rating to prove it.
vi.mock("./MediaDetailPanel", async () => {
  const { useState } = await import("react");
  return {
    DetailPanel: ({ item, onClose }: { item: SearchResult; onClose: () => void }) => (
      <div>
        <p>Detail panel: {item.name}</p>
        <button type="button" onClick={onClose}>close panel</button>
      </div>
    ),
    useDetailPanel: () => {
      const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
      return {
        selectedItem,
        setSelectedItem,
        panelHistory: [],
        setPanelHistory: () => {},
        panelHistoryLoading: false,
        detail: null,
        detailLoading: false,
      };
    },
  };
});

const { api } = await import("../api");
const search = vi.mocked(api.search);

function result(name: string, type: "movie" | "series" = "movie"): SearchResult {
  return {
    imdbId: `tt-${name.toLowerCase()}`,
    type,
    name,
    year: 2001,
    poster: null,
    description: null,
    genres: [],
    rating: null,
    inWatchlist: false,
    inCollection: false,
    lists: [],
  };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="path">{location.pathname + location.search}</p>;
}

function renderPalette(open = true) {
  const onClose = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={["/"]}>
      <ToastProvider>
        <CommandPalette open={open} onClose={onClose} />
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>
  );
  return { ...view, onClose };
}

const path = () => screen.getByTestId("path").textContent;

beforeEach(() => {
  search.mockResolvedValue([]);
});

describe("CommandPalette", () => {
  it("renders nothing until it is opened", () => {
    renderPalette(false);

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("takes focus on open, so typing goes to the palette", async () => {
    renderPalette();

    await waitFor(() => expect(screen.getByLabelText("Search everything")).toHaveFocus());
  });

  it("runs the highlighted action on Enter, having arrowed down to it", async () => {
    const user = userEvent.setup();
    renderPalette();
    await waitFor(() => expect(screen.getByLabelText("Search everything")).toHaveFocus());

    // Dashboard, Search, Lists — the third action down.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await waitFor(() => expect(path()).toBe("/lists"));
  });

  it("stops at the first row rather than wrapping past the top", async () => {
    const user = userEvent.setup();
    renderPalette();
    await waitFor(() => expect(screen.getByLabelText("Search everything")).toHaveFocus());

    await user.keyboard("{ArrowDown}{ArrowUp}{ArrowUp}{Enter}");

    await waitFor(() => expect(path()).toBe("/"));
  });

  it("filters the actions as you type", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByLabelText("Search everything"), "settings");

    expect(screen.getByRole("button", { name: /go to settings/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /go to lists/i })).not.toBeInTheDocument();
  });

  it("opens a title from the results without leaving the page", async () => {
    const user = userEvent.setup();
    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    renderPalette();

    await user.type(screen.getByLabelText("Search everything"), "sol");
    await user.click(await screen.findByRole("button", { name: /Solaris/ }));

    expect(await screen.findByText("Detail panel: Solaris")).toBeInTheDocument();
    expect(path()).toBe("/");
  });

  it("hands the palette back when that panel closes, query intact", async () => {
    const user = userEvent.setup();
    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    renderPalette();

    await user.type(screen.getByLabelText("Search everything"), "sol");
    await user.click(await screen.findByRole("button", { name: /Solaris/ }));
    await user.click(screen.getByRole("button", { name: "close panel" }));

    expect(await screen.findByLabelText("Search everything")).toHaveValue("sol");
    expect(screen.getByRole("button", { name: /Solaris/ })).toBeInTheDocument();
  });

  it("Enter on the highlighted title opens it rather than running an action", async () => {
    const user = userEvent.setup();
    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    renderPalette();

    await user.type(screen.getByLabelText("Search everything"), "sol");
    await screen.findByRole("button", { name: /Solaris/ });
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Detail panel: Solaris")).toBeInTheDocument();
  });

  it("says search is unavailable instead of reporting no matches", async () => {
    const user = userEvent.setup();
    search.mockRejectedValue(new Error("TMDB is not configured"));
    renderPalette();

    await user.type(screen.getByLabelText("Search everything"), "sol");

    expect(await screen.findByText(/search is unavailable right now/i)).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPalette();
    await waitFor(() => expect(screen.getByLabelText("Search everything")).toHaveFocus());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 1000 });
  });

  it("opens on a clean slate the next time", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter initialEntries={["/"]}>
        <ToastProvider>
          <CommandPalette open onClose={onClose} />
          <LocationProbe />
        </ToastProvider>
      </MemoryRouter>
    );
    await user.type(screen.getByLabelText("Search everything"), "sol");

    const palette = (open: boolean) => (
      <MemoryRouter initialEntries={["/"]}>
        <ToastProvider>
          <CommandPalette open={open} onClose={onClose} />
          <LocationProbe />
        </ToastProvider>
      </MemoryRouter>
    );
    rerender(palette(false));
    rerender(palette(true));

    expect(await screen.findByLabelText("Search everything")).toHaveValue("");
  });
});
