import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Settings } from "lucide-react";
import { Section } from "./Section";

// jsdom has no layout, so every element measures 0 and the height animation is
// invisible to the assertions below. Give the panel a size to animate between.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 500 });
});
afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
});

const sectionElement = (props: Partial<Parameters<typeof Section>[0]> = {}) => (
  <Section title="Trakt Integration" icon={<Settings size={20} />} storageKey="trakt" {...props}>
    <p>Panel body</p>
  </Section>
);

const renderSection = (props: Partial<Parameters<typeof Section>[0]> = {}) => render(sectionElement(props));

const header = () => screen.getByRole("button", { name: /trakt integration/i });
const panel = () => screen.getByRole("region", { name: /trakt integration/i });

describe("Section", () => {
  it("starts collapsed, so a settings page of them is a list rather than a stack of forms", () => {
    renderSection();
    expect(header()).toHaveAttribute("aria-expanded", "false");
  });

  it("starts open when the page asks it to", () => {
    renderSection({ defaultOpen: true });
    expect(header()).toHaveAttribute("aria-expanded", "true");
  });

  it("remembers what the user opened, in preference to the default", async () => {
    const { unmount } = renderSection();
    await userEvent.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(localStorage.getItem("cataloggy:settings-section:trakt")).toBe("1");

    unmount();
    renderSection();
    expect(header()).toHaveAttribute("aria-expanded", "true");
  });

  it("remembers what the user closed, in preference to the default", async () => {
    const { unmount } = renderSection({ defaultOpen: true });
    await userEvent.click(header());
    expect(localStorage.getItem("cataloggy:settings-section:trakt")).toBe("0");

    unmount();
    renderSection({ defaultOpen: true });
    expect(header()).toHaveAttribute("aria-expanded", "false");
  });

  it("mounts collapsed at zero height, without flashing its body open first", () => {
    renderSection();
    expect(panel()).toHaveStyle({ height: "0px" });
  });

  it("still animates the height when the user opens it", async () => {
    renderSection();
    await userEvent.click(header());
    expect(panel()).toHaveStyle({ height: "500px" });
  });

  it("drops the toggle entirely when held open, so the chevron can't disagree with the panel", () => {
    localStorage.setItem("cataloggy:settings-section:trakt", "0");
    renderSection({ alwaysOpen: true });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Panel body")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /trakt integration/i })).toBeInTheDocument();
  });

  it("hands the section back to the user's own preference when it stops being held open", async () => {
    localStorage.setItem("cataloggy:settings-section:trakt", "0");
    const { rerender } = renderSection({ alwaysOpen: true });

    rerender(sectionElement({ alwaysOpen: false }));

    expect(header()).toHaveAttribute("aria-expanded", "false");
    // Unlike the mount case this one animates: it was on screen a frame ago.
    await waitFor(() => expect(panel()).toHaveStyle({ height: "0px" }));
    expect(localStorage.getItem("cataloggy:settings-section:trakt")).toBe("0");
  });

  it("stays open after being held open, when that is what the user had chosen", () => {
    localStorage.setItem("cataloggy:settings-section:trakt", "1");
    const { rerender } = renderSection({ alwaysOpen: true });

    rerender(sectionElement({ alwaysOpen: false }));

    expect(header()).toHaveAttribute("aria-expanded", "true");
  });
});
