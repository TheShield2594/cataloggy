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
const track = (container: HTMLElement) => container.querySelector(".overflow-x-auto") as HTMLElement;

describe("CarouselTrack", () => {
  it("renders no edge fade when the row fits entirely on screen", () => {
    const { container } = renderTrack(false, false);
    expect(fades(container)).toHaveLength(0);
  });

  it("fades only the right edge at the start of a scrollable row", () => {
    const { container } = renderTrack(false, true);
    const found = fades(container);
    expect(found).toHaveLength(1);
    expect(found[0].getAttribute("data-carousel-fade")).toBe("right");
    expect(found[0]).toHaveStyle({ background: "linear-gradient(to left, var(--bg-0), transparent)" });
  });

  it("fades only the left edge at the end of a scrollable row", () => {
    const { container } = renderTrack(true, false);
    const found = fades(container);
    expect(found).toHaveLength(1);
    expect(found[0].getAttribute("data-carousel-fade")).toBe("left");
  });

  it("fades both edges mid-scroll", () => {
    const { container } = renderTrack(true, true);
    expect([...fades(container)].map((el) => el.getAttribute("data-carousel-fade"))).toEqual(["left", "right"]);
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
