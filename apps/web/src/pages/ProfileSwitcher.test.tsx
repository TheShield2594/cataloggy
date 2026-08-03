import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, Profile, runtimeConfig } from "../api";
import { ProfileSwitcher } from "./ProfileSwitcher";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      getProfiles: vi.fn(),
      createProfile: vi.fn(),
      verifyProfile: vi.fn(),
    },
  };
});

// Imported after the mock so `api` here is the mocked object.
const { api } = await import("../api");
const getProfiles = vi.mocked(api.getProfiles);
const createProfile = vi.mocked(api.createProfile);
const verifyProfile = vi.mocked(api.verifyProfile);

const BEN: Profile = { id: "p-ben", name: "Ben", hasPin: false };
const LOCKED: Profile = { id: "p-kid", name: "Kid", hasPin: true };

beforeEach(() => {
  getProfiles.mockResolvedValue({ profiles: [BEN, LOCKED] });
});

const renderSwitcher = (props: Partial<React.ComponentProps<typeof ProfileSwitcher>> = {}) => {
  const onSelected = vi.fn();
  render(<ProfileSwitcher onSelected={onSelected} {...props} />);
  return { onSelected };
};

describe("ProfileSwitcher", () => {
  it("shows a loading state, then the profiles it fetched", async () => {
    renderSwitcher();

    expect(screen.getByText(/loading profiles/i)).toBeInTheDocument();

    expect(await screen.findByRole("button", { name: /ben/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /kid/i })).toBeInTheDocument();
    expect(screen.getByText(/who's watching/i)).toBeInTheDocument();
  });

  it("reports a failed profile fetch instead of hanging on the spinner", async () => {
    getProfiles.mockRejectedValue(new Error("Network error – cannot reach API"));

    renderSwitcher();

    expect(await screen.findByText(/cannot reach api/i)).toBeInTheDocument();
  });

  it("goes straight to profile creation when the install has no profiles yet", async () => {
    getProfiles.mockResolvedValue({ profiles: [] });

    renderSwitcher();

    expect(await screen.findByText(/create your first profile/i)).toBeInTheDocument();
    // Nothing to go back to, so no cancel escape hatch.
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  describe("selecting a PIN-free profile", () => {
    it("verifies it, stores the id and hands it back", async () => {
      verifyProfile.mockResolvedValue({ id: BEN.id, name: BEN.name });
      const { onSelected } = renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /ben/i }));

      await waitFor(() => expect(onSelected).toHaveBeenCalledWith(BEN));
      expect(verifyProfile).toHaveBeenCalledWith(BEN.id);
      expect(runtimeConfig.getProfileId()).toBe(BEN.id);
    });

    it("surfaces a failure and keeps the previous selection", async () => {
      runtimeConfig.setProfileId("p-previous");
      verifyProfile.mockRejectedValue(new ApiError("Profile not found", 404));
      const { onSelected } = renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /ben/i }));

      expect(await screen.findByText(/profile not found/i)).toBeInTheDocument();
      expect(onSelected).not.toHaveBeenCalled();
      expect(runtimeConfig.getProfileId()).toBe("p-previous");
    });
  });

  describe("PIN entry", () => {
    it("prompts for a PIN instead of verifying straight away", async () => {
      renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /kid/i }));

      expect(screen.getByText(/enter pin for kid/i)).toBeInTheDocument();
      expect(verifyProfile).not.toHaveBeenCalled();
    });

    it("keeps the unlock button disabled until a PIN is typed", async () => {
      renderSwitcher();
      await userEvent.click(await screen.findByRole("button", { name: /kid/i }));

      const unlock = screen.getByRole("button", { name: /unlock/i });
      expect(unlock).toBeDisabled();

      await userEvent.type(screen.getByPlaceholderText("PIN"), "1234");

      expect(unlock).toBeEnabled();
    });

    it("unlocks the profile on a correct PIN", async () => {
      verifyProfile.mockResolvedValue({ id: LOCKED.id, name: LOCKED.name, profileToken: "signed" });
      const { onSelected } = renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /kid/i }));
      await userEvent.type(screen.getByPlaceholderText("PIN"), "1234");
      await userEvent.click(screen.getByRole("button", { name: /unlock/i }));

      await waitFor(() => expect(onSelected).toHaveBeenCalledWith(LOCKED));
      expect(verifyProfile).toHaveBeenCalledWith(LOCKED.id, "1234");
      expect(runtimeConfig.getProfileId()).toBe(LOCKED.id);
    });

    it("reports an incorrect PIN without selecting the profile", async () => {
      verifyProfile.mockRejectedValue(new ApiError("Unauthorized", 401));
      const { onSelected } = renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /kid/i }));
      await userEvent.type(screen.getByPlaceholderText("PIN"), "0000{Enter}");

      expect(await screen.findByText(/incorrect pin/i)).toBeInTheDocument();
      expect(onSelected).not.toHaveBeenCalled();
      expect(runtimeConfig.getProfileId()).toBe("");
    });

    it("distinguishes a server error from a wrong PIN", async () => {
      verifyProfile.mockRejectedValue(new ApiError("Profile store unavailable", 500));
      renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /kid/i }));
      await userEvent.type(screen.getByPlaceholderText("PIN"), "1234{Enter}");

      expect(await screen.findByText(/profile store unavailable/i)).toBeInTheDocument();
      expect(screen.queryByText(/incorrect pin/i)).not.toBeInTheDocument();
    });

    it("returns to the picker without selecting anything", async () => {
      const { onSelected } = renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /kid/i }));
      await userEvent.click(screen.getByRole("button", { name: /back/i }));

      expect(screen.getByText(/who's watching/i)).toBeInTheDocument();
      expect(onSelected).not.toHaveBeenCalled();
    });
  });

  describe("creating a profile", () => {
    it("sends the trimmed name with no PIN when the PIN field is left blank", async () => {
      const created: Profile = { id: "p-new", name: "Sam", hasPin: false };
      createProfile.mockResolvedValue({ profile: created });
      const { onSelected } = renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /new profile/i }));
      await userEvent.type(screen.getByPlaceholderText("Profile name"), "  Sam  ");
      await userEvent.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => expect(onSelected).toHaveBeenCalledWith(created));
      expect(createProfile).toHaveBeenCalledWith({ name: "Sam", pin: undefined });
      expect(runtimeConfig.getProfileId()).toBe("p-new");
    });

    it("passes the PIN through when one is given", async () => {
      createProfile.mockResolvedValue({ profile: { id: "p-new", name: "Sam", hasPin: true } });
      renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /new profile/i }));
      await userEvent.type(screen.getByPlaceholderText("Profile name"), "Sam");
      await userEvent.type(screen.getByPlaceholderText("PIN (optional)"), "4321");
      await userEvent.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => expect(createProfile).toHaveBeenCalledWith({ name: "Sam", pin: "4321" }));
    });

    it("cannot be submitted with a blank name", async () => {
      renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /new profile/i }));
      await userEvent.type(screen.getByPlaceholderText("Profile name"), "   ");

      expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
      expect(createProfile).not.toHaveBeenCalled();
    });

    it("shows the server's rejection and stays on the form", async () => {
      createProfile.mockRejectedValue(new ApiError("A profile named Sam already exists", 409));
      const { onSelected } = renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /new profile/i }));
      await userEvent.type(screen.getByPlaceholderText("Profile name"), "Sam");
      await userEvent.click(screen.getByRole("button", { name: /create/i }));

      expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
      expect(onSelected).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText("Profile name")).toHaveValue("Sam");
    });
  });

  describe("as a modal switcher", () => {
    it("closes on the close button and on Escape", async () => {
      const onClose = vi.fn();
      renderSwitcher({ onClose });
      await screen.findByRole("button", { name: /ben/i });

      await userEvent.click(screen.getByRole("button", { name: /close/i }));
      expect(onClose).toHaveBeenCalledOnce();

      await userEvent.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("renders as a labelled modal dialog", async () => {
      renderSwitcher({ onClose: vi.fn() });
      await screen.findByRole("button", { name: /ben/i });

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAccessibleName("Switch profile");
    });

    it("has no dismiss affordance when used as the full-page gate", async () => {
      renderSwitcher();
      await screen.findByRole("button", { name: /ben/i });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("heads the full-page gate with an h1", async () => {
      renderSwitcher();

      expect(await screen.findByRole("heading", { level: 1, name: /who's watching/i })).toBeInTheDocument();
    });

    it("drops to an h2 as a modal, since the page behind still owns the h1", async () => {
      renderSwitcher({ onClose: vi.fn() });

      expect(await screen.findByRole("heading", { level: 2, name: /who's watching/i })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    });

    it("names the PIN and create fields without relying on their placeholders", async () => {
      renderSwitcher();

      await userEvent.click(await screen.findByRole("button", { name: /kid/i }));
      expect(screen.getByLabelText("PIN for Kid")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /back/i }));
      await userEvent.click(screen.getByRole("button", { name: /new profile/i }));
      expect(screen.getByLabelText("Profile name")).toBeInTheDocument();
      expect(screen.getByLabelText("PIN (optional)")).toBeInTheDocument();
    });
  });
});
