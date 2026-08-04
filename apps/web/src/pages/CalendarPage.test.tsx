import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEntry } from "../api";
import { ToastProvider } from "../hooks/useToast";
import { CalendarPage } from "./CalendarPage";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { getCalendar: vi.fn() } };
});

vi.mock("../components/MediaDetailPanel", () => ({
  DetailPanel: () => null,
  useDetailPanel: () => ({
    selectedItem: null,
    setSelectedItem: vi.fn(),
    panelHistory: [],
    setPanelHistory: vi.fn(),
    panelHistoryLoading: false,
  }),
}));

const { api } = await import("../api");
const getCalendar = vi.mocked(api.getCalendar);

// The 15th is inside whichever month the grid opens on, whatever today is.
const MID_MONTH = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
})();

function episode(name: string, episodeNumber: number): CalendarEntry {
  return {
    seriesImdbId: `tt-${name.toLowerCase()}`,
    seriesName: name,
    poster: null,
    season: 1,
    episode: episodeNumber,
    episodeName: `${name} pilot`,
    airDate: MID_MONTH,
    overview: null,
  };
}

const CROWDED_DAY = [episode("Severance", 1), episode("Andor", 2), episode("Silo", 3), episode("Foundation", 4)];

/** Makes `matchMedia` report a phone-width viewport. */
function mockCompactViewport(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList);
}

const renderPage = () => render(<ToastProvider><CalendarPage /></ToastProvider>);

/** Renders and switches to the month grid. */
async function renderMonthView(user: ReturnType<typeof userEvent.setup>) {
  renderPage();
  await user.click(await screen.findByRole("button", { name: /month/i }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  getCalendar.mockResolvedValue({ calendar: CROWDED_DAY });
});

describe("CalendarPage month view", () => {
  it("reaches the episodes a day cell had to hide", async () => {
    const user = userEvent.setup();
    await renderMonthView(user);

    // Two fit in the cell; the rest are only named by the "+N more" control.
    const more = await screen.findByRole("button", { name: /show all 4 episodes/i });
    expect(more).toHaveTextContent("+2 more");
    expect(screen.queryByText(/silo/i)).not.toBeInTheDocument();

    await user.click(more);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("4 episodes")).toBeInTheDocument();
    for (const entry of CROWDED_DAY) {
      expect(within(dialog).getByText(entry.seriesName)).toBeInTheDocument();
    }

    await user.click(within(dialog).getByRole("button", { name: /close dialog/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the day list when the month changes under it", async () => {
    const user = userEvent.setup();
    await renderMonthView(user);

    await user.click(await screen.findByRole("button", { name: /show all 4 episodes/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains why there is no going back past the current month", async () => {
    const user = userEvent.setup();
    await renderMonthView(user);

    expect(screen.getByRole("button", { name: /previous month/i })).toBeDisabled();
    expect(screen.getByText(/forward-looking/i)).toBeInTheDocument();

    // A month ahead, stepping back is how you return.
    await user.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByRole("button", { name: /previous month/i })).toBeEnabled();
    expect(screen.queryByText(/forward-looking/i)).not.toBeInTheDocument();
  });
});

describe("CalendarPage on a phone", () => {
  it("stays on the agenda and drops the unusable month view", async () => {
    mockCompactViewport(true);
    renderPage();

    expect(await screen.findByRole("button", { name: /14 days/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^month$/i })).not.toBeInTheDocument();
    // The seven-column grid is what doesn't fit; its weekday header goes with it.
    expect(screen.queryByText("Wed")).not.toBeInTheDocument();
  });

  it("still offers the month view on a wider screen", async () => {
    mockCompactViewport(false);
    renderPage();

    expect(await screen.findByRole("button", { name: /^month$/i })).toBeInTheDocument();
  });
});
