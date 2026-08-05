import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesSettings } from "./PreferencesSettings";

const getPreferences = vi.fn();
const updatePreferences = vi.fn();

vi.mock("../../api", () => ({
  api: {
    getPreferences: () => getPreferences(),
    updatePreferences: (body: unknown) => updatePreferences(body),
  },
}));

const LOADED = { language: "en-US", region: "US", spoilerProtection: false };

beforeEach(() => {
  getPreferences.mockReset().mockResolvedValue(LOADED);
  updatePreferences.mockReset().mockImplementation((body) => Promise.resolve({ ...LOADED, ...(body as object) }));
});

async function renderLoaded() {
  render(<PreferencesSettings />);
  await screen.findByLabelText("Metadata Language");
}

describe("PreferencesSettings", () => {
  it("saves a changed select without a submit button", async () => {
    await renderLoaded();
    expect(screen.queryByRole("button", { name: /save preferences/i })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Metadata Language"), "fr-FR");

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ language: "fr-FR" }));
  });

  it("posts the value just chosen, not the one it replaced", async () => {
    // The change handler fires before its own setState has landed, so a save
    // that read `language` back out of state would post the previous value.
    await renderLoaded();
    await userEvent.selectOptions(screen.getByLabelText("Streaming Region"), "DE");

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    expect(updatePreferences).toHaveBeenCalledWith({ language: "en-US", region: "DE", spoilerProtection: false });
  });

  it("saves the spoiler switch, and exposes it as a switch", async () => {
    await renderLoaded();
    const toggle = screen.getByRole("switch", { name: /spoiler protection/i });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ spoilerProtection: true })));
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("confirms a save in a live region", async () => {
    await renderLoaded();
    await userEvent.selectOptions(screen.getByLabelText("Metadata Language"), "de-DE");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("reports a failed save instead of implying it landed", async () => {
    updatePreferences.mockRejectedValue(new Error("nope"));
    await renderLoaded();

    await userEvent.selectOptions(screen.getByLabelText("Metadata Language"), "ja-JP");

    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
});
