import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TmdbSettings } from "./TmdbSettings";

const getTmdbStatus = vi.fn();
const setTmdbKey = vi.fn();
const removeTmdbKey = vi.fn();

vi.mock("../../api", () => ({
  api: {
    getTmdbStatus: () => getTmdbStatus(),
    setTmdbKey: (apiKey: string) => setTmdbKey(apiKey),
    removeTmdbKey: () => removeTmdbKey(),
  },
}));

beforeEach(() => {
  getTmdbStatus.mockReset().mockResolvedValue({ configured: false, source: null });
  setTmdbKey.mockReset().mockResolvedValue({ configured: true, source: "db" });
  removeTmdbKey.mockReset().mockResolvedValue({ configured: false, source: null });
});

async function renderLoaded() {
  render(<TmdbSettings />);
  await screen.findByLabelText("TMDB API key");
}

describe("TmdbSettings", () => {
  it("saves a pasted key and reports it active", async () => {
    await renderLoaded();

    await userEvent.type(screen.getByLabelText("TMDB API key"), "  a-key  ");
    await userEvent.click(screen.getByRole("button", { name: /save tmdb key/i }));

    await waitFor(() => expect(setTmdbKey).toHaveBeenCalledWith("a-key"));
    expect(await screen.findByText("Active")).toBeInTheDocument();
    // Cleared, so the next paste isn't appended to the key just saved.
    expect(screen.getByLabelText("TMDB API key")).toHaveValue("");
  });

  it("surfaces the reason a key was rejected", async () => {
    setTmdbKey.mockRejectedValue(new Error("TMDB rejected that API key"));
    await renderLoaded();

    await userEvent.type(screen.getByLabelText("TMDB API key"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /save tmdb key/i }));

    expect(await screen.findByText(/tmdb rejected that api key/i)).toBeInTheDocument();
  });

  // Removing can only clear a key this app saved, so offering it against an
  // environment-provided key would be a button that does nothing.
  it("offers no removal for a key that comes from the environment", async () => {
    getTmdbStatus.mockResolvedValue({ configured: true, source: "env" });
    await renderLoaded();

    expect(screen.getByText(/active \(environment\)/i)).toBeInTheDocument();
    expect(screen.getByText(/TMDB_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove key/i })).not.toBeInTheDocument();
  });

  it("keeps the form available so a saved key can be replaced in one step", async () => {
    getTmdbStatus.mockResolvedValue({ configured: true, source: "db" });
    await renderLoaded();

    expect(screen.getByRole("button", { name: /replace tmdb key/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove key/i })).toBeInTheDocument();
  });

  it("shows the environment key that removal falls back to", async () => {
    getTmdbStatus.mockResolvedValue({ configured: true, source: "db" });
    removeTmdbKey.mockResolvedValue({ configured: true, source: "env" });
    await renderLoaded();

    await userEvent.click(screen.getByRole("button", { name: /remove key/i }));

    expect(await screen.findByText(/active \(environment\)/i)).toBeInTheDocument();
  });
});
