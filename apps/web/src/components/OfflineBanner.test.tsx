import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "./OfflineBanner";

const setOnLine = (value: boolean) => vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);

const fire = (event: "online" | "offline") =>
  act(() => {
    window.dispatchEvent(new Event(event));
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OfflineBanner", () => {
  it("says nothing while the device has a connection", () => {
    setOnLine(true);
    render(<OfflineBanner />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("explains that the data on screen is cached once the connection drops", () => {
    setOnLine(true);
    render(<OfflineBanner />);

    setOnLine(false);
    fire("offline");

    expect(screen.getByRole("status")).toHaveTextContent(/Offline.*showing saved data/);
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
