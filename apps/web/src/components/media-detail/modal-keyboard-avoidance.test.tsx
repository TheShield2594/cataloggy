/**
 * The two dialogs the "Log a Watch" and "Check in" flows open both take a
 * season/episode number and a date — the fields that raise the on-screen
 * keyboard — and both were missed when ef2e068 taught the command palette and
 * the three search modals to fit above it.
 *
 * On iOS `100vh`, and `inset-0` on a fixed element, are the *layout* viewport,
 * which keeps its full height when the keyboard appears. So the dialog was laid
 * out against a screen that was no longer there: the number fields sat under
 * the keyboard, and Safari scrolling the visual viewport to reach them took the
 * header off the top at the same time.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckInModal } from "./CheckInModal";
import { WatchDateModal } from "./WatchDateModal";

/** A phone with the keyboard up: a short viewport, scrolled down to the field. */
function installViewport({ offsetTop = 0, height = 844, width = 390 } = {}) {
  Object.defineProperty(window, "visualViewport", {
    value: {
      offsetTop,
      offsetLeft: 0,
      width,
      height,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    configurable: true,
    writable: true,
  });
}

/** The scrim: the fixed element the dialog is centred in. */
const scrim = () => screen.getByRole("dialog").parentElement!;

afterEach(() => {
  Reflect.deleteProperty(window, "visualViewport");
});

describe("keyboard avoidance in the watch modals", () => {
  it("pins the log-a-watch dialog to the slice of screen the keyboard leaves", () => {
    installViewport({ offsetTop: 120, height: 380 });

    render(
      <WatchDateModal
        target={{ kind: "episode", seriesImdbId: "tt1", season: 2, episode: 3 }}
        onLog={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(scrim()).toHaveStyle({ top: "120px", left: "0px", width: "390px", height: "380px" });
  });

  it("pins the check-in dialog the same way", () => {
    installViewport({ offsetTop: 120, height: 380 });

    render(
      <CheckInModal
        seriesName="Severance"
        defaultSeason={2}
        defaultEpisode={3}
        onCheckIn={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(scrim()).toHaveStyle({ top: "120px", left: "0px", width: "390px", height: "380px" });
  });

  it("leaves the classes in charge where there is no visual viewport to read", () => {
    // Desktop browsers without the API, and jsdom. `inset-0` is right wherever
    // the layout and visual viewports agree.
    render(
      <CheckInModal
        seriesName="Severance"
        defaultSeason={1}
        defaultEpisode={1}
        onCheckIn={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(scrim().getAttribute("style")).toBe(null);
  });

  it("keeps the top of the dialog reachable when it is taller than what is left", () => {
    // Centring is what a full-height screen wants and what a 380px band cannot
    // give: half the dialog would sit above the top of the scroll range, where
    // no gesture reaches it. Small screens start it at the top and scroll.
    installViewport({ height: 380 });

    render(
      <WatchDateModal
        target={{ kind: "movie", imdbId: "tt1", releaseDate: "2020-01-01" }}
        onLog={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(scrim().className).toContain("items-start");
    expect(scrim().className).toContain("sm:items-center");
    expect(scrim().className).toContain("overflow-y-auto");
  });
});
