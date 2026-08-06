import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationChannelsSettings } from "./NotificationChannelsSettings";
import type { NotificationChannel } from "../../api";

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      getNotificationChannels: vi.fn(),
      createNotificationChannel: vi.fn(),
      updateNotificationChannel: vi.fn(),
      deleteNotificationChannel: vi.fn(),
      testNotificationChannel: vi.fn(),
    },
  };
});

const { api } = await import("../../api");
const getNotificationChannels = vi.mocked(api.getNotificationChannels);
const createNotificationChannel = vi.mocked(api.createNotificationChannel);
const updateNotificationChannel = vi.mocked(api.updateNotificationChannel);
const deleteNotificationChannel = vi.mocked(api.deleteNotificationChannel);
const testNotificationChannel = vi.mocked(api.testNotificationChannel);

const channel = (over: Partial<NotificationChannel> = {}): NotificationChannel => ({
  id: "channel-1",
  kind: "ntfy",
  name: "Phone",
  url: "https://ntfy.sh/cataloggy",
  hasToken: false,
  enabled: true,
  createdAt: "2026-08-06T12:00:00Z",
  ...over,
});

async function renderChannels() {
  render(<NotificationChannelsSettings />);
  await waitFor(() => expect(screen.queryByText("Loading channels...")).not.toBeInTheDocument());
}

describe("NotificationChannelsSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNotificationChannels.mockResolvedValue({ channels: [] });
    createNotificationChannel.mockResolvedValue({ channel: channel() });
    updateNotificationChannel.mockResolvedValue({ channel: channel({ enabled: false }) });
    deleteNotificationChannel.mockResolvedValue({ deleted: true });
    testNotificationChannel.mockResolvedValue({ success: true });
  });

  it("adds a channel and lists it without a reload", async () => {
    await renderChannels();

    await userEvent.type(screen.getByLabelText("Topic URL"), "https://ntfy.sh/cataloggy");
    await userEvent.click(screen.getByRole("button", { name: /add channel/i }));

    await waitFor(() => expect(screen.getByText("Phone")).toBeInTheDocument());
    expect(createNotificationChannel).toHaveBeenCalledWith({
      kind: "ntfy",
      name: undefined,
      url: "https://ntfy.sh/cataloggy",
      token: undefined,
    });
  });

  it("relabels the fields for the selected channel and only asks for a token when one is needed", async () => {
    await renderChannels();

    expect(screen.queryByLabelText("Application token")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Channel"), "gotify");
    expect(screen.getByLabelText("Server URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Application token")).toBeInTheDocument();

    // Discord's webhook URL carries its own credential, so there's nothing to ask for.
    await userEvent.selectOptions(screen.getByLabelText("Channel"), "discord");
    expect(screen.getByLabelText("Webhook URL")).toBeInTheDocument();
    expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
  });

  it("won't submit a Gotify channel without the token it requires", async () => {
    await renderChannels();

    await userEvent.selectOptions(screen.getByLabelText("Channel"), "gotify");
    await userEvent.type(screen.getByLabelText("Server URL"), "http://192.168.1.25:8080");
    expect(screen.getByRole("button", { name: /add channel/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Application token"), "app-token");
    expect(screen.getByRole("button", { name: /add channel/i })).toBeEnabled();
  });

  it("surfaces the server's rejection instead of leaving the form looking saved", async () => {
    createNotificationChannel.mockRejectedValue(new Error("url must include the topic"));
    await renderChannels();

    await userEvent.type(screen.getByLabelText("Topic URL"), "https://ntfy.sh");
    await userEvent.click(screen.getByRole("button", { name: /add channel/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("url must include the topic");
  });

  it("reports a failed test send rather than claiming it worked", async () => {
    getNotificationChannels.mockResolvedValue({ channels: [channel()] });
    testNotificationChannel.mockResolvedValue({ success: false, error: "Phone: HTTP 403" });
    await renderChannels();

    await userEvent.click(screen.getByRole("button", { name: /send a test notification to phone/i }));

    expect(await screen.findByText("Phone: HTTP 403")).toBeInTheDocument();
  });

  it("toggles a channel off through the API and reflects what came back", async () => {
    getNotificationChannels.mockResolvedValue({ channels: [channel()] });
    await renderChannels();

    await userEvent.click(screen.getByRole("button", { name: /disable phone/i }));

    await waitFor(() => expect(screen.getByText("Disabled")).toBeInTheDocument());
    expect(updateNotificationChannel).toHaveBeenCalledWith("channel-1", { enabled: false });
  });

  it("asks before removing a channel, and drops it from the list once removed", async () => {
    getNotificationChannels.mockResolvedValue({ channels: [channel()] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderChannels();

    await userEvent.click(screen.getByRole("button", { name: /remove phone/i }));
    expect(deleteNotificationChannel).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: /remove phone/i }));

    await waitFor(() => expect(screen.queryByText("Phone")).not.toBeInTheDocument());
    confirm.mockRestore();
  });

  it("says the list couldn't be loaded rather than showing an empty one", async () => {
    // "No channels yet" over a failed request reads as a settled fact, and
    // invites adding a second copy of a channel that is already there.
    getNotificationChannels.mockRejectedValue(new Error("Network error"));
    await renderChannels();

    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.queryByText("No channels yet.")).not.toBeInTheDocument();
  });

  it("shows the token as write-only: a stored one is never rendered back", async () => {
    getNotificationChannels.mockResolvedValue({ channels: [channel({ kind: "gotify", hasToken: true })] });
    await renderChannels();

    const row = screen.getByRole("listitem");
    expect(within(row).getByText("https://ntfy.sh/cataloggy")).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/token/i);
  });
});
