import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JellyseerrSettings } from "./JellyseerrSettings";

const getJellyseerrConfig = vi.fn();
const saveJellyseerrConfig = vi.fn();
const removeJellyseerrConfig = vi.fn();
const testJellyseerr = vi.fn();

vi.mock("../../api", () => ({
  api: {
    getJellyseerrConfig: () => getJellyseerrConfig(),
    saveJellyseerrConfig: (payload: unknown) => saveJellyseerrConfig(payload),
    removeJellyseerrConfig: () => removeJellyseerrConfig(),
    testJellyseerr: () => testJellyseerr(),
  },
}));

const CONFIG = { url: "http://jellyseerr.lan:5055", requestOnAdd: true, cancelOnRemove: false, hasApiKey: true };

beforeEach(() => {
  getJellyseerrConfig.mockReset().mockResolvedValue({ configured: false, config: null });
  saveJellyseerrConfig.mockReset().mockResolvedValue({ configured: true, config: CONFIG });
  removeJellyseerrConfig.mockReset().mockResolvedValue({ configured: false, config: null });
  testJellyseerr.mockReset().mockResolvedValue({ success: true, version: "2.5.2", applicationTitle: "Home Requests" });
});

async function renderLoaded() {
  render(<JellyseerrSettings />);
  await screen.findByLabelText(/server url/i);
}

describe("JellyseerrSettings", () => {
  it("saves a new connection with requesting on by default and cancelling off", async () => {
    await renderLoaded();

    await userEvent.type(screen.getByLabelText(/server url/i), "http://jellyseerr.lan:5055");
    await userEvent.type(screen.getByLabelText(/api key/i), "js_key");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(saveJellyseerrConfig).toHaveBeenCalledWith({
        url: "http://jellyseerr.lan:5055",
        apiKey: "js_key",
        requestOnAdd: true,
        cancelOnRemove: false,
      })
    );
    expect(await screen.findByText(/requesting watchlist adds/i)).toBeInTheDocument();
  });

  it("omits the key when the field is left blank, so a toggle keeps the stored one", async () => {
    getJellyseerrConfig.mockResolvedValue({ configured: true, config: CONFIG });
    await renderLoaded();

    await userEvent.click(screen.getByRole("checkbox", { name: /cancel the request/i }));
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(saveJellyseerrConfig).toHaveBeenCalled());
    // Strict: `toEqual` counts a present-but-undefined `apiKey` as absent,
    // which is the one thing this test is here to rule out.
    expect(saveJellyseerrConfig.mock.calls[0]?.[0]).toStrictEqual({
      url: CONFIG.url,
      requestOnAdd: true,
      cancelOnRemove: true,
    });
  });

  it("reports which instance answered a test", async () => {
    getJellyseerrConfig.mockResolvedValue({ configured: true, config: CONFIG });
    await renderLoaded();

    await userEvent.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/reached home requests \(v2\.5\.2\)/i)).toBeInTheDocument();
  });

  it("shows the verdict when a test fails", async () => {
    getJellyseerrConfig.mockResolvedValue({ configured: true, config: CONFIG });
    testJellyseerr.mockResolvedValue({
      success: false,
      outcome: "unreachable",
      error: "Could not reach that address — check the host and port. The server log has the details.",
    });
    await renderLoaded();

    await userEvent.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/could not reach that address/i)).toBeInTheDocument();
  });

  it("surfaces why a save was refused", async () => {
    saveJellyseerrConfig.mockRejectedValue(new Error("Jellyseerr rejected that API key."));
    await renderLoaded();

    await userEvent.type(screen.getByLabelText(/server url/i), "http://jellyseerr.lan:5055");
    await userEvent.type(screen.getByLabelText(/api key/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/rejected that api key/i);
  });

  it("offers disconnecting only once something is configured", async () => {
    // Unmounted before the second render: `screen` queries every mounted
    // container, so two live instances would make any shared element ambiguous.
    const unconfigured = render(<JellyseerrSettings />);
    await screen.findByLabelText(/server url/i);
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
    unconfigured.unmount();

    getJellyseerrConfig.mockResolvedValue({ configured: true, config: CONFIG });
    render(<JellyseerrSettings />);

    const disconnect = await screen.findByRole("button", { name: /disconnect/i });
    await userEvent.click(disconnect);

    await waitFor(() => expect(removeJellyseerrConfig).toHaveBeenCalled());
  });
});
