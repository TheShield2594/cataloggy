import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallButton } from "./InstallButton";

type ModeListener = () => void;

const listeners: ModeListener[] = [];

/** Stub matchMedia so that only the given display modes report a match. */
function mockDisplayModes(...modes: string[]) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: modes.some((mode) => query === `(display-mode: ${mode})`),
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener: (_type: string, listener: ModeListener) => listeners.push(listener),
        removeEventListener: (_type: string, listener: ModeListener) => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  );
}

/** Chrome's install offer — without it the button has nothing to prompt with. */
function offerInstall() {
  act(() => {
    window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true }));
  });
}

const installButton = () => screen.queryByRole("button", { name: /install cataloggy/i });

afterEach(() => {
  listeners.length = 0;
});

describe("InstallButton", () => {
  it("offers to install in a browser tab", () => {
    mockDisplayModes("browser");
    render(<InstallButton />);
    offerInstall();

    expect(installButton()).toBeInTheDocument();
  });

  it("goes away when an open tab becomes the installed app", () => {
    mockDisplayModes("browser");
    render(<InstallButton />);
    offerInstall();
    expect(installButton()).toBeInTheDocument();

    // Installing from the omnibox moves this very document into the installed
    // window — no reload, so the media-query change is the only notice.
    mockDisplayModes("standalone");
    act(() => {
      for (const listener of [...listeners]) listener();
    });

    expect(installButton()).not.toBeInTheDocument();
  });

  it("never offers to install from inside the installed app", () => {
    mockDisplayModes("standalone");
    render(<InstallButton />);
    offerInstall();

    expect(installButton()).not.toBeInTheDocument();
  });
});
