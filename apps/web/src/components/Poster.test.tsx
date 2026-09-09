import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { Poster } from "./Poster";

/**
 * jsdom never loads an image, so `complete` is always false and `naturalWidth`
 * always 0. Patching the prototype's accessors for the duration of one render
 * is how a test can put an <img> into the one state that matters here: already
 * decoded at the instant React's ref callback runs, which is synchronous and
 * during the commit — so nothing asynchronous can set it up in time.
 */
function whileEveryImageIsAlreadyDecoded<T>(run: () => T): T {
  const original = {
    complete: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete"),
    naturalWidth: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth"),
  };
  Object.defineProperty(HTMLImageElement.prototype, "complete", { get: () => true, configurable: true });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { get: () => 500, configurable: true });
  try {
    return run();
  } finally {
    if (original.complete) Object.defineProperty(HTMLImageElement.prototype, "complete", original.complete);
    if (original.naturalWidth) Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", original.naturalWidth);
  }
}

const image = () => screen.getByRole("img") as HTMLImageElement;

describe("Poster", () => {
  it("draws initials over a gradient when there is no artwork to show", () => {
    render(<Poster src={undefined} alt="The Long Shore" />);

    expect(screen.getByText("TL")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("falls back to the same placeholder when the artwork fails to load", () => {
    render(<Poster src="https://image.tmdb.org/t/p/w500/a.jpg" alt="The Long Shore" />);
    fireEvent.error(image());

    expect(screen.getByText("TL")).toBeInTheDocument();
  });

  it("fades a poster in over a shimmer while the bytes are in flight", () => {
    const { container } = render(<Poster src="https://image.tmdb.org/t/p/w500/a.jpg" alt="A" />);

    expect(container.querySelector(".skeleton")).not.toBeNull();
    expect(image().className).toContain("opacity-0");

    fireEvent.load(image());

    expect(container.querySelector(".skeleton")).toBeNull();
    expect(image().className).toContain("opacity-100");
  });

  /*
   * The regression this component's ref callback exists to prevent, and which
   * a mount effect used to reintroduce one tick later: an image that is
   * already decoded when React first sees it has no `load` event left to fire,
   * so anything that clears the loaded flag after the ref has set it leaves
   * the poster invisible for good.
   */
  it("paints an already-decoded image opaque on the first frame, and keeps it that way", () => {
    whileEveryImageIsAlreadyDecoded(() => render(<Poster src="data:image/svg+xml;utf8,<svg/>" alt="A" eager />));

    // No `load` event is fired here on purpose: for an image the browser
    // completed on assignment there would never be one, so this is the whole
    // of what the component gets to work with.
    expect(image().className).toContain("opacity-100");
  });

  it("goes back to the shimmer when the artwork itself changes", () => {
    const { container, rerender } = render(<Poster src="https://image.tmdb.org/t/p/w500/a.jpg" alt="A" />);
    fireEvent.load(image());
    expect(container.querySelector(".skeleton")).toBeNull();

    rerender(<Poster src="https://image.tmdb.org/t/p/w500/b.jpg" alt="B" />);

    expect(container.querySelector(".skeleton")).not.toBeNull();
    expect(image().className).toContain("opacity-0");
  });

  it("re-tries a new src after a failure, rather than staying on the placeholder", () => {
    const { rerender } = render(<Poster src="https://image.tmdb.org/t/p/w500/a.jpg" alt="A" />);
    fireEvent.error(image());
    expect(screen.queryByRole("img")).toBeNull();

    rerender(<Poster src="https://image.tmdb.org/t/p/w500/b.jpg" alt="A" />);

    expect(image()).toHaveAttribute("src", "https://image.tmdb.org/t/p/w500/b.jpg");
  });

  it("asks TMDB for the width the slot actually needs, and leaves other hosts alone", () => {
    const { rerender } = render(<Poster src="https://image.tmdb.org/t/p/w500/a.jpg" alt="A" sizes="192px" />);

    expect(image().getAttribute("srcset")).toContain("https://image.tmdb.org/t/p/w92/a.jpg 92w");
    expect(image()).toHaveAttribute("sizes", "192px");

    rerender(<Poster src="https://cdn.example.com/a.jpg" alt="A" sizes="192px" />);

    expect(image().getAttribute("srcset")).toBeNull();
    expect(image().getAttribute("sizes")).toBeNull();
  });

  it("prioritises above-fold artwork and defers the rest", () => {
    const { rerender } = render(<Poster src="https://image.tmdb.org/t/p/w500/a.jpg" alt="A" eager />);
    expect(image()).toHaveAttribute("loading", "eager");
    expect(image()).toHaveAttribute("fetchpriority", "high");

    rerender(<Poster src="https://image.tmdb.org/t/p/w500/a.jpg" alt="A" />);
    expect(image()).toHaveAttribute("loading", "lazy");
    expect(image()).toHaveAttribute("fetchpriority", "low");
  });
});
