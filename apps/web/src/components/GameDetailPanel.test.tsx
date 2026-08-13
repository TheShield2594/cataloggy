import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../api";
import { GameDetailPanel } from "./GameDetailPanel";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      updateGame: vi.fn(),
      deleteGame: vi.fn(),
    },
  };
});

const { api } = await import("../api");
const updateGame = vi.mocked(api.updateGame);

const game = (over: Partial<Game> = {}): Game => ({
  id: "game-a",
  igdbId: 1,
  steamAppId: null,
  title: "Outer Wilds",
  coverUrl: null,
  releaseDate: null,
  genres: [],
  playtimeMinutes: 0,
  lastPlayedAt: null,
  rating: null,
  notes: null,
  finished: false,
  finishedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const panel = (current: Game) => (
  <GameDetailPanel
    game={current}
    onClose={() => {}}
    onUpdated={() => {}}
    onDeleted={() => {}}
    onShowToast={() => {}}
  />
);

describe("GameDetailPanel notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateGame.mockResolvedValue({ game: game() });
  });

  it("saves a draft the panel is closed on, rather than dropping it", async () => {
    // Notes are debounced by 600ms, so closing straight after typing would
    // otherwise lose the edit.
    const { unmount } = render(panel(game()));

    fireEvent.change(screen.getByPlaceholderText(/Add personal notes/i), {
      target: { value: "loop" },
    });
    unmount();

    await waitFor(() => expect(updateGame).toHaveBeenCalledTimes(1));
    expect(updateGame).toHaveBeenCalledWith("game-a", { notes: "loop" });
  });

  it("flushes a pending draft to the game it was typed against, not the one on screen next", async () => {
    // GamesPage renders this panel without a `key`, so switching games reuses
    // the instance and only swaps the `game` prop.
    //
    // fireEvent rather than userEvent, and no await before the unmount: the
    // whole point is to close the panel *inside* the 600ms debounce window, so
    // that the flush runs while a draft is still pending. Let the timer fire
    // first and it saves correctly on its own — bound to the closure from the
    // render that typed it — and the bug this covers never appears.
    const { rerender, unmount } = render(panel(game()));

    fireEvent.change(screen.getByPlaceholderText(/Add personal notes/i), {
      target: { value: "loop" },
    });
    rerender(panel(game({ id: "game-b", title: "Tunic" })));
    unmount();

    await waitFor(() => expect(updateGame).toHaveBeenCalledTimes(1));
    expect(updateGame).toHaveBeenCalledWith("game-a", { notes: "loop" });
  });
});
