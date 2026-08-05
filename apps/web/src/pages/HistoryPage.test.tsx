import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { WatchEvent } from "../api";
import { ToastProvider } from "../hooks/useToast";
import { HistoryPage } from "./HistoryPage";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      getWatchHistory: vi.fn(),
      deleteWatchEvent: vi.fn(),
      updateWatchEventNote: vi.fn(),
      logWatch: vi.fn(),
    },
  };
});

// The panel fetches metadata and history of its own the moment a row opens;
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
const getWatchHistory = vi.mocked(api.getWatchHistory);
const deleteWatchEvent = vi.mocked(api.deleteWatchEvent);
const updateWatchEventNote = vi.mocked(api.updateWatchEventNote);

function watched(name: string, over: Partial<WatchEvent> = {}): WatchEvent {
  return {
    id: `ev-${name.toLowerCase()}`,
    imdbId: `tt-${name.toLowerCase()}`,
    type: "movie",
    name,
    watchedAt: new Date().toISOString(),
    dateUnknown: false,
    note: null,
    ...over,
  };
}

const ALIEN = watched("Alien");
const SOLARIS = watched("Solaris", { note: "Rewatch — still holds up" });

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <HistoryPage />
      </ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  getWatchHistory.mockResolvedValue([ALIEN, SOLARIS]);
  // jsdom has no viewport, so the infinite-scroll sentinel never intersects on
  // its own — which is what these cases want: one page, loaded once.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

describe("HistoryPage", () => {
  it("asks the server for the filtered type rather than filtering the loaded page", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getByRole("button", { name: "Episodes" }));

    await waitFor(() =>
      expect(getWatchHistory).toHaveBeenLastCalledWith(25, 0, { type: "episode" })
    );
  });

  it("keeps the filter pills reachable when the fetch fails", async () => {
    getWatchHistory.mockRejectedValue(new Error("Network down"));
    renderPage();

    expect(await screen.findByText("Network down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Movies" })).toBeInTheDocument();
  });

  it("removes a row optimistically and offers the way back", async () => {
    const user = userEvent.setup();
    deleteWatchEvent.mockResolvedValue(undefined as never);
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getAllByRole("button", { name: "Delete watch event" })[0]);

    await waitFor(() => expect(screen.queryByText("Alien")).not.toBeInTheDocument());
    expect(await screen.findByText(/Removed Alien from history/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  it("puts a row back when the delete fails", async () => {
    const user = userEvent.setup();
    deleteWatchEvent.mockRejectedValue(new Error("Server said no"));
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getAllByRole("button", { name: "Delete watch event" })[0]);

    expect(await screen.findByText("Server said no")).toBeInTheDocument();
    expect(screen.getByText("Alien")).toBeInTheDocument();
  });
});

describe("HistoryPage notes", () => {
  it("shows a note that came with the event", async () => {
    renderPage();

    expect(await screen.findByText("Rewatch — still holds up")).toBeInTheDocument();
  });

  it("adds a note to a watch that had none", async () => {
    const user = userEvent.setup();
    updateWatchEventNote.mockResolvedValue({ watchEvent: watched("Alien", { note: "Saw it at the BFI" }) });
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getByRole("button", { name: /add note to alien/i }));
    await user.type(screen.getByLabelText(/^note on alien$/i), "Saw it at the BFI");
    await user.click(screen.getByRole("button", { name: /save note/i }));

    expect(await screen.findByText("Saw it at the BFI")).toBeInTheDocument();
    expect(updateWatchEventNote).toHaveBeenCalledWith(ALIEN.id, "Saw it at the BFI");
    expect(screen.queryByRole("button", { name: /save note/i })).not.toBeInTheDocument();
  });

  it("clears a note when the field is emptied, rather than saving a blank one", async () => {
    const user = userEvent.setup();
    updateWatchEventNote.mockResolvedValue({ watchEvent: watched("Solaris", { note: null }) });
    renderPage();
    await screen.findByText("Rewatch — still holds up");

    await user.click(screen.getByRole("button", { name: /edit note on solaris/i }));
    await user.clear(screen.getByLabelText(/^note on solaris$/i));
    await user.click(screen.getByRole("button", { name: /save note/i }));

    expect(updateWatchEventNote).toHaveBeenCalledWith(SOLARIS.id, null);
    await waitFor(() =>
      expect(screen.queryByText("Rewatch — still holds up")).not.toBeInTheDocument()
    );
  });

  // A failed save that closed the editor would cost the user everything they
  // typed, and the row would go on showing the old note as if nothing happened.
  it("keeps the draft open when the save fails", async () => {
    const user = userEvent.setup();
    updateWatchEventNote.mockRejectedValue(new Error("Save failed"));
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getByRole("button", { name: /add note to alien/i }));
    await user.type(screen.getByLabelText(/^note on alien$/i), "Half-written thought");
    await user.click(screen.getByRole("button", { name: /save note/i }));

    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(screen.getByLabelText(/^note on alien$/i)).toHaveValue("Half-written thought");
  });

  it("doesn't call the server when nothing changed", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Rewatch — still holds up");

    await user.click(screen.getByRole("button", { name: /edit note on solaris/i }));
    await user.click(screen.getByRole("button", { name: /save note/i }));

    expect(updateWatchEventNote).not.toHaveBeenCalled();
    expect(screen.getByText("Rewatch — still holds up")).toBeInTheDocument();
  });

  it("discards the draft on Escape", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getByRole("button", { name: /add note to alien/i }));
    await user.type(screen.getByLabelText(/^note on alien$/i), "Never mind{Escape}");

    expect(screen.queryByLabelText(/^note on alien$/i)).not.toBeInTheDocument();
    expect(updateWatchEventNote).not.toHaveBeenCalled();
  });
});
