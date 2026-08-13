import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PushSettings } from "./PushSettings";

vi.mock("../../api", () => ({ api: { pushSubscribe: vi.fn() } }));

// jsdom has neither, which is also the state a browser reports on an insecure
// origin — so the two cases are told apart by `isSecureContext` alone.
const setSecureContext = (value: boolean) =>
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });

afterEach(() => {
  setSecureContext(false);
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

  it("still blames the browser when the origin is fine and the APIs are missing", () => {
    setSecureContext(true);

    render(<PushSettings />);

    expect(screen.getByText(/aren't supported in this browser/i)).toBeInTheDocument();
  });
});
