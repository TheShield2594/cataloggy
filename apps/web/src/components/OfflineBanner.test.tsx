import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "./OfflineBanner";

const setOnLine = (value: boolean) => vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);

// jsdom reports an insecure context by default, which is the LAN-IP case rather
// than the https one most of these cases are about.
const setSecureContext = (value: boolean) =>
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });

const fire = (event: "online" | "offline") =>
  act(() => {
    window.dispatchEvent(new Event(event));
  });

afterEach(() => {
  vi.restoreAllMocks();
  setSecureContext(false);
});

describe("OfflineBanner", () => {
  it("says nothing while the device has a connection", () => {
    setOnLine(true);
    render(<OfflineBanner />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("explains that the data on screen is cached once the connection drops", () => {
    setSecureContext(true);
    setOnLine(true);
    render(<OfflineBanner />);

    setOnLine(false);
    fire("offline");

    expect(screen.getByRole("status")).toHaveTextContent(/Offline.*showing saved data/);
  });

  it("doesn't promise saved data on an origin that was never allowed a cache", () => {
    // The README's LAN quickstart lands on `http://192.168.x.x:7002`, where the
    // browser refuses to register a service worker at all — so there is no
    // stale-while-revalidate layer and nothing was ever stored to fall back on.
    setSecureContext(false);
    setOnLine(false);
    render(<OfflineBanner />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/nothing is saved for offline use/i);
    expect(banner).not.toHaveTextContent(/showing saved data/i);
  });

  it("clears itself when the connection comes back", () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    setOnLine(true);
    fire("online");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders offline straight away when the app loads without a connection", () => {
    setOnLine(false);
    render(<OfflineBanner />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
