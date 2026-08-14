import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PushSettings } from "./PushSettings";

vi.mock("../../api", () => ({ api: { pushSubscribe: vi.fn() } }));

// jsdom has neither, which is also the state a browser reports on an insecure
// origin — so the two cases are told apart by `isSecureContext` alone.
const setSecureContext = (value: boolean) =>
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });

const setUserAgent = (value: string) =>
  Object.defineProperty(navigator, "userAgent", { value, configurable: true });

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

/** Everything `isPushSupported()` looks for, plus a stubbed permission state. */
function installPushApis(permission: NotificationPermission) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { permission, requestPermission: vi.fn() });
}

afterEach(() => {
  setSecureContext(false);
  setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/27");
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PushSettings when push is unavailable", () => {
  it("names the origin, not the browser, on a plain-http install", () => {
    // `http://192.168.x.x:7002` — the address the README's LAN quickstart hands
    // out. `navigator.serviceWorker` is undefined there however current the
    // browser is, and the old copy sent people off to try a different one.
    setSecureContext(false);

    render(<PushSettings />);

    expect(screen.getByText(/https:\/\//)).toBeInTheDocument();
    expect(screen.getByText(/nothing to do with your browser/i)).toBeInTheDocument();
    expect(screen.queryByText(/aren't supported in this browser/i)).not.toBeInTheDocument();
  });

  it("sends an iPhone in a Safari tab to Add to Home Screen", () => {
    // Web Push exists on iOS 16.4+, but only for home-screen apps: in a tab the
    // APIs are simply absent, so the old copy told the one person whose browser
    // *does* support push that their browser doesn't.
    setSecureContext(true);
    setUserAgent(IPHONE_UA);

    render(<PushSettings />);

    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByText(/aren't supported in this browser/i)).not.toBeInTheDocument();
  });

  it("blames the origin ahead of the platform on a plain-http iPhone", () => {
    // Adding to the Home Screen wouldn't help: over http there's no service
    // worker there either.
    setSecureContext(false);
    setUserAgent(IPHONE_UA);

    render(<PushSettings />);

    expect(screen.getByText(/nothing to do with your browser/i)).toBeInTheDocument();
    expect(screen.queryByText(/Add to Home Screen/)).not.toBeInTheDocument();
  });

  it("does not send an installed iOS app to Add to Home Screen", () => {
    setSecureContext(true);
    setUserAgent(IPHONE_UA);
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });

    try {
      render(<PushSettings />);

      expect(screen.queryByText(/Add to Home Screen/)).not.toBeInTheDocument();
      expect(screen.getByText(/aren't supported in this browser/i)).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, "standalone");
    }
  });

  it("still blames the browser when the origin is fine and the APIs are missing", () => {
    setSecureContext(true);

    render(<PushSettings />);

    expect(screen.getByText(/aren't supported in this browser/i)).toBeInTheDocument();
  });
});

describe("PushSettings when notifications are blocked", () => {
  it("explains the block instead of offering a button that can't ask", async () => {
    // `Notification.requestPermission()` resolves instantly, with no browser UI,
    // once permission is denied — so the button looked like it did nothing.
    setSecureContext(true);
    installPushApis("denied");

    render(<PushSettings />);

    expect(await screen.findByText(/blocking notifications for this site/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enable Notifications/i })).not.toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("offers the button as usual when permission has not been asked for yet", async () => {
    setSecureContext(true);
    installPushApis("default");

    render(<PushSettings />);

    expect(await screen.findByRole("button", { name: /Enable Notifications/i })).toBeInTheDocument();
    expect(screen.queryByText(/blocking notifications for this site/i)).not.toBeInTheDocument();
  });
});
