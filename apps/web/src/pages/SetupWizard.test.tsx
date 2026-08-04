import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeConfig } from "../api";
import { SetupWizard, WIZARD_STEPS, previousStep } from "./SetupWizard";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { getTmdbStatus: vi.fn() } };
});

// Talks to the server and opens an OAuth flow; the wizard only places it.
vi.mock("../components/settings/TraktSettings", () => ({ TraktSettings: () => <p>trakt settings</p> }));

const { api } = await import("../api");
const getTmdbStatus = vi.mocked(api.getTmdbStatus);

beforeEach(() => {
  getTmdbStatus.mockResolvedValue({ configured: true });
});

/** Enters a token and lands on the tmdb step. */
async function enterToken(user: ReturnType<typeof userEvent.setup>, token = "secret-token") {
  await user.type(screen.getByLabelText(/api token/i), token);
  await user.click(screen.getByRole("button", { name: /continue/i }));
  expect(await screen.findByText(/tmdb metadata/i)).toBeInTheDocument();
}

describe("previousStep", () => {
  it("has no step before the entry point", () => {
    expect(previousStep("token")).toBeNull();
  });

  it("walks back one step at a time", () => {
    expect(WIZARD_STEPS.map(previousStep)).toEqual([null, "token", "tmdb", "trakt"]);
  });
});

describe("SetupWizard", () => {
  it("labels the progress indicator with the step it is on", async () => {
    const user = userEvent.setup();
    render(<SetupWizard onComplete={vi.fn()} />);

    const progress = screen.getByRole("progressbar", { name: /setup progress/i });
    expect(progress).toHaveAttribute("aria-valuenow", "1");
    expect(progress).toHaveAttribute("aria-valuemax", String(WIZARD_STEPS.length));
    expect(screen.getByText(`Step 1 of ${WIZARD_STEPS.length}`)).toBeInTheDocument();

    await enterToken(user);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByText(`Step 2 of ${WIZARD_STEPS.length}`)).toBeInTheDocument();
  });

  it("offers no way back from the entry step", () => {
    render(<SetupWizard onComplete={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
  });

  it("steps back to the token, carrying the token that got there", async () => {
    const user = userEvent.setup();
    render(<SetupWizard onComplete={vi.fn()} />);
    await enterToken(user, "mistyped-token");

    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(await screen.findByText(/welcome to cataloggy/i)).toBeInTheDocument();
    // Prefilled, so a typo is a correction rather than a retype.
    expect(screen.getByLabelText(/api token/i)).toHaveValue("mistyped-token");
    expect(runtimeConfig.getToken()).toBe("mistyped-token");
  });

  it("walks back through every step after the first", async () => {
    const user = userEvent.setup();
    render(<SetupWizard onComplete={vi.fn()} />);
    await enterToken(user);

    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/connect trakt/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/you're all set/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByText(/connect trakt/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByText(/tmdb metadata/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1"));
  });
});
