import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

// React logs every caught error itself, on top of the boundary's own
// componentDidCatch. Four lines of stack per assertion is not signal.
beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

function Boom({ throws }: { throws: boolean }): React.ReactNode {
  if (throws) throw new Error("render blew up");
  return <p>page content</p>;
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Boom throws={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("announces the fallback rather than swapping it in silently", () => {
    render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  // The reason the page variant exists: before it, the single boundary sat
  // above BrowserRouter, so a throw on any route blanked the header, sidebar
  // and tab bar as well and left no way to reach a page that still worked.
  it("leaves everything outside it on screen", () => {
    render(
      <div>
        <nav>site navigation</nav>
        <ErrorBoundary variant="page">
          <Boom throws />
        </ErrorBoundary>
      </div>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("site navigation")).toBeInTheDocument();
  });

  it("sizes the page fallback to its column and the app fallback to the window", () => {
    const { rerender } = render(
      <ErrorBoundary variant="page">
        <Boom throws />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert").className).not.toContain("min-h-screen");

    rerender(
      <ErrorBoundary variant="app">
        <Boom throws />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert").className).toContain("min-h-screen");
  });

  it("rebuilds the children from scratch on Try Again", async () => {
    const user = userEvent.setup();
    // Flipped by the test rather than by the component's own first render:
    // React retries a failed concurrent render synchronously, so a
    // throw-once-then-succeed child recovers before the boundary ever sees it.
    let broken = true;
    const Flaky = () => {
      if (broken) throw new Error("render blew up");
      return <p>page content</p>;
    };

    render(
      <ErrorBoundary variant="page">
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Stands in for whatever the retry is hoping has changed — a request that
    // failed the first time, a feed that was mid-write.
    broken = false;
    await user.click(screen.getByRole("button", { name: "Try Again" }));
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // App.tsx keys this boundary on location.pathname for exactly this reason:
  // without the key, the fallback for the route that threw would still be up
  // over the route the user navigated to next.
  it("clears the error when remounted under a new key", () => {
    const { rerender } = render(
      <ErrorBoundary key="/stats" variant="page">
        <Boom throws />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <ErrorBoundary key="/lists" variant="page">
        <Boom throws={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
