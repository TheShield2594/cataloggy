import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CarouselTrack } from "./CarouselTrack";

const renderTrack = (canScrollLeft: boolean, canScrollRight: boolean) =>
  render(
    <CarouselTrack scrollRef={() => {}} canScrollLeft={canScrollLeft} canScrollRight={canScrollRight} className="gap-4">
      <button type="button">Card</button>
    </CarouselTrack>
  );

const fades = (container: HTMLElement) => container.querySelectorAll("[data-carousel-fade]");
const fade = (container: HTMLElement, side: "left" | "right") =>
  container.querySelector(`[data-carousel-fade="${side}"]`) as HTMLElement;
const isVisible = (el: HTMLElement) => !el.className.includes("opacity-0");
const track = (container: HTMLElement) => container.querySelector(".overflow-x-auto") as HTMLElement;

describe("CarouselTrack", () => {
  it("hides both edge fades when the row fits entirely on screen", () => {
    const { container } = renderTrack(false, false);
    expect(isVisible(fade(container, "left"))).toBe(false);
    expect(isVisible(fade(container, "right"))).toBe(false);
  });

  it("keeps both fades mounted with an opacity transition, so they ease in and out rather than pop", () => {
    const { container } = renderTrack(false, false);
    const found = fades(container);
    expect(found).toHaveLength(2);
    for (const el of found) expect(el.className).toContain("transition-opacity");
  });

  it("shows only the right fade at the start of a scrollable row", () => {
    const { container } = renderTrack(false, true);
    expect(isVisible(fade(container, "left"))).toBe(false);
    expect(isVisible(fade(container, "right"))).toBe(true);
    expect(fade(container, "right")).toHaveStyle({ background: "linear-gradient(to left, var(--bg-0), transparent)" });
  });

  it("shows only the left fade at the end of a scrollable row", () => {
    const { container } = renderTrack(true, false);
    expect(isVisible(fade(container, "left"))).toBe(true);
    expect(isVisible(fade(container, "right"))).toBe(false);
  });

  it("shows both fades mid-scroll", () => {
    const { container } = renderTrack(true, true);
    expect(isVisible(fade(container, "left"))).toBe(true);
    expect(isVisible(fade(container, "right"))).toBe(true);
  });

  it("snaps flicks to card boundaries without hijacking mid-row scrolling", () => {
    const { container } = renderTrack(true, true);
    const el = track(container);
    // proximity, not mandatory: only a flick that ends near a boundary settles
    // on it. snap-start rides on the children, where snap alignment must live.
    expect(el.className).toContain("snap-x");
    expect(el.className).toContain("snap-proximity");
    expect(el.className).toContain("[&>*]:snap-start");
  });

  it("keeps the fades out of the accessibility tree and out of the way of clicks", () => {
    const { container } = renderTrack(true, true);
    for (const fade of fades(container)) {
      expect(fade).toHaveAttribute("aria-hidden", "true");
      expect(fade.className).toContain("pointer-events-none");
    }
  });

  it("does not mask the scroll container, so card focus rings and shadows survive", () => {
    const { container } = renderTrack(true, true);
    const el = track(container);
    expect(el.style.maskImage).toBe("");
    expect(el.style.webkitMaskImage ?? "").toBe("");
  });

  it("reserves scroll padding so a focused card lands past the fade", () => {
    const { container } = renderTrack(true, true);
    // 32px of scroll padding matches the 32px (w-8) fade, so the card the
    // browser scrolls into view on keyboard focus is never underneath it.
    expect(track(container).className).toContain("scroll-px-8");
    for (const fade of fades(container)) expect(fade.className).toContain("w-8");
  });

  it("gives the row room inside its own clip box for hover lift and ring offsets", () => {
    const { container } = renderTrack(false, false);
    expect(track(container).className).toContain("p-2");
    expect(track(container).parentElement?.className).toContain("-m-2");
  });

  it("fades into a caller-supplied colour when the row sits on another surface", () => {
    const { container } = render(
      <CarouselTrack scrollRef={() => {}} canScrollLeft canScrollRight={false} fadeColor="var(--bg-1)">
        <span>Card</span>
      </CarouselTrack>
    );
    expect(fades(container)[0]).toHaveStyle({ background: "linear-gradient(to right, var(--bg-1), transparent)" });
  });
});
