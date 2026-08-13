import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const originNotice = () =>
  screen.queryByRole("button", { name: /why can't cataloggy be installed/i });

// jsdom reports an insecure context, which is the LAN-IP case. Cases about the
// install offer itself need the secure one.
const setSecureContext = (value: boolean) =>
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });

afterEach(() => {
  listeners.length = 0;
  setSecureContext(false);
  localStorage.clear();
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

describe("InstallButton on an insecure origin", () => {
  it("says why there is no install offer instead of rendering nothing", async () => {
    // `http://192.168.x.x:7002`: Chrome won't fire `beforeinstallprompt`, so the
    // header used to be empty here and a headline feature was simply missing
    // with nothing to explain it.
    const user = userEvent.setup();
    mockDisplayModes("browser");
    setSecureContext(false);
    render(<InstallButton />);

    expect(installButton()).not.toBeInTheDocument();
    const notice = originNotice();
    expect(notice).toBeInTheDocument();

    await user.click(notice!);
    expect(screen.getByText(/https:\/\//)).toBeInTheDocument();
  });

  it("stays out of the way once dismissed", async () => {
    const user = userEvent.setup();
    mockDisplayModes("browser");
    setSecureContext(false);
    const first = render(<InstallButton />);

    await user.click(screen.getByRole("button", { name: /dismiss install notice/i }));
    expect(originNotice()).not.toBeInTheDocument();

    first.unmount();
    render(<InstallButton />);
    expect(originNotice()).not.toBeInTheDocument();
  });

  it("keeps quiet when the origin is secure and the browser simply hasn't offered yet", () => {
    mockDisplayModes("browser");
    setSecureContext(true);
    render(<InstallButton />);

    expect(originNotice()).not.toBeInTheDocument();
    expect(installButton()).not.toBeInTheDocument();
  });
});
