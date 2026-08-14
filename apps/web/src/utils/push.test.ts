import { afterEach, describe, expect, it, vi } from "vitest";
import { getPushAvailability, subscribeToPush } from "./push";

vi.mock("../api", () => ({ api: { getPushPublicKey: vi.fn(), pushSubscribe: vi.fn() } }));

const setSecureContext = (value: boolean) =>
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });

const setUserAgent = (value: string) =>
  Object.defineProperty(navigator, "userAgent", { value, configurable: true });

const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

const setMaxTouchPoints = (value: number) =>
  Object.defineProperty(navigator, "maxTouchPoints", { value, configurable: true });

afterEach(() => {
  setSecureContext(false);
  setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/27");
  setMaxTouchPoints(0);
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.unstubAllGlobals();
});

describe("getPushAvailability", () => {
  it("recognises an iPad even though it claims to be a Mac", () => {
    // iPadOS 13+ sends a desktop Safari user agent by default, so the classic
    // /ipad/ test misses every iPad there is. No real Mac reports touch points.
    setSecureContext(true);
    setUserAgent(IPAD_DESKTOP_UA);
    setMaxTouchPoints(5);

    expect(getPushAvailability()).toBe("ios-needs-home-screen");
  });

  it("doesn't mistake a Mac for an iPad", () => {
    setSecureContext(true);
    setUserAgent(IPAD_DESKTOP_UA);
    setMaxTouchPoints(0);

    expect(getPushAvailability()).toBe("unsupported");
  });
});

describe("subscribeToPush", () => {
  it("explains a standing block rather than reporting a declined prompt", async () => {
    // `requestPermission()` resolves instantly with "denied" and shows nothing,
    // so "permission was not granted" describes a prompt the user never saw.
    // The only way back is the browser's own site settings.
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
    vi.stubGlobal("PushManager", class {});
    const requestPermission = vi.fn().mockResolvedValue("denied");
    vi.stubGlobal("Notification", { permission: "denied", requestPermission });

    await expect(subscribeToPush()).rejects.toThrow(/blocked for this site/i);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
