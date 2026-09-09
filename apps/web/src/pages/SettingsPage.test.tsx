import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { INITIALLY_OPEN_SECTION_IDS, SETTINGS_SECTIONS, SETTINGS_TABS, SettingsPage, matchesSearch, type SettingsTab } from "./SettingsPage";

// Each section's body is its own component's business, and most of them fetch
// on mount. Stub them out: what this file tests is which sections the page
// shows, which is decided entirely by the section list and the search box.
vi.mock("../components/settings/PreferencesSettings", () => ({ PreferencesSettings: () => <p>preferences body</p> }));
vi.mock("../components/settings/ProfileSettings", () => ({ ProfileSettings: () => <p>profile body</p> }));
vi.mock("../components/settings/PushSettings", () => ({ PushSettings: () => <p>notifications body</p> }));
vi.mock("../components/settings/JobStatusSettings", () => ({ JobStatusSettings: () => <p>sync status body</p> }));
vi.mock("../components/settings/ApiTokenSettings", () => ({ ApiTokenSettings: () => <p>api token body</p> }));
vi.mock("../components/settings/TraktSettings", () => ({ TraktSettings: () => <p>trakt body</p> }));
vi.mock("../components/settings/AddonSettings", () => ({ AddonSettings: () => <p>addon body</p> }));
vi.mock("../components/settings/StremioSyncSettings", () => ({ StremioSyncSettings: () => <p>stremio sync body</p> }));
vi.mock("../components/settings/PlayDetectionSettings", () => ({ PlayDetectionSettings: () => <p>play detection body</p> }));
vi.mock("../components/settings/OmdbSettings", () => ({ OmdbSettings: () => <p>omdb body</p> }));
vi.mock("../components/settings/RpdbSettings", () => ({ RpdbSettings: () => <p>rpdb body</p> }));
vi.mock("../components/settings/AiSettings", () => ({ AiSettings: () => <p>ai body</p> }));
vi.mock("../components/settings/DataSettings", () => ({ DataSettings: () => <p>data body</p> }));

// Health is six status requests and its own mapping rules, both tested
// elsewhere (hooks/useSettingsHealth, components/settings/health.test.ts). Held
// empty by default here so a section header's accessible name is just its
// title; the cases that are about the status rows set it themselves.
const health = vi.hoisted(() => ({ value: {} as Record<string, { tone: "ok" | "warn" | "bad" | "idle"; label: string }> }));
vi.mock("../hooks/useSettingsHealth", () => ({ useSettingsHealth: () => health.value }));

beforeEach(() => {
  health.value = {};
});

const byTab = (tab: SettingsTab) => SETTINGS_SECTIONS.filter((s) => s.tab === tab);
const find = (query: string) => SETTINGS_SECTIONS.filter((s) => matchesSearch(s, query)).map((s) => s.id);

describe("settings sections", () => {
  it("gives every section a unique storage key", () => {
    expect(new Set(SETTINGS_SECTIONS.map((s) => s.id)).size).toBe(SETTINGS_SECTIONS.length);
  });

  it("opens exactly one section per tab by default — the first one", () => {
    for (const tab of SETTINGS_TABS) {
      const open = byTab(tab.id).filter((s) => INITIALLY_OPEN_SECTION_IDS.has(s.id));
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe(byTab(tab.id)[0].id);
    }
  });

  it("never labels a section the same as the tab holding it", () => {
    for (const tab of SETTINGS_TABS) {
      expect(byTab(tab.id).map((s) => s.title)).not.toContain(tab.label);
    }
  });

  it("matches everything when the query is empty or blank", () => {
    expect(find("")).toHaveLength(SETTINGS_SECTIONS.length);
    expect(find("   ")).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it("finds a section by a word in its title, ignoring case", () => {
    expect(find("region")).toEqual(["preferences"]);
    // In list order, which is now grouped by what a thing does: the two that
    // bring history in, then the addon this server publishes.
    expect(find("STREMIO")).toEqual(["stremio-sync", "play-detection", "addon"]);
  });

  it("finds a section by what it does, not only by what it is called", () => {
    expect(find("backup")).toEqual(["data"]);
    expect(find("pin")).toEqual(["profile"]);
    expect(find("ollama")).toEqual(["ai"]);
  });

  it("reaches sections on either tab", () => {
    expect(find("trakt")).toEqual(expect.arrayContaining(["job-status", "trakt"]));
    expect(new Set(SETTINGS_SECTIONS.filter((s) => matchesSearch(s, "trakt")).map((s) => s.tab)).size).toBe(2);
  });

  it("narrows on each extra term rather than widening", () => {
    expect(find("rating")).toEqual(expect.arrayContaining(["omdb", "rpdb"]));
    expect(find("rating poster")).toEqual(["rpdb"]);
  });

  it("matches nothing when a term is absent", () => {
    expect(find("bluray")).toEqual([]);
  });
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/settings"]}>
      <SettingsPage />
    </MemoryRouter>
  );

// Each section renders a panel labelled by its own header, open or shut, so the
// panels are what "is this section on screen?" comes down to.
const onScreen = () => SETTINGS_SECTIONS.filter((s) => screen.queryByRole("region", { name: s.title })).map((s) => s.title);
const searchBox = () => screen.getByLabelText("Search settings");
// role="tab", not "button": the tab strip is a real tablist, so a query that
// still found a plain button would mean the roles had been dropped again.
const tabBar = () => screen.queryByRole("tab", { name: SETTINGS_TABS[1].label });

describe("SettingsPage", () => {
  // The tab strip is a real tablist, which is a promise of arrow-key navigation
  // and a roving tabindex — announcing the role without implementing them is the
  // mistake the list panel's `role="menu"` made.
  describe("the tab strip's keyboard contract", () => {
    it("moves between tabs with the arrow keys, selecting as it goes", async () => {
      renderPage();
      const [first, second] = SETTINGS_TABS.map((t) => screen.getByRole("tab", { name: t.label }));
      expect(first).toHaveAttribute("aria-selected", "true");

      first.focus();
      await userEvent.keyboard("{ArrowRight}");

      expect(second).toHaveFocus();
      expect(second).toHaveAttribute("aria-selected", "true");
      expect(onScreen()).toEqual(byTab("integrations").map((s) => s.title));
    });

    it("wraps around, and Home/End go straight to the ends", async () => {
      renderPage();
      const [first, last] = SETTINGS_TABS.map((t) => screen.getByRole("tab", { name: t.label }));

      first.focus();
      await userEvent.keyboard("{ArrowLeft}");
      expect(last).toHaveFocus();

      await userEvent.keyboard("{Home}");
      expect(first).toHaveFocus();

      await userEvent.keyboard("{End}");
      expect(last).toHaveFocus();
    });

    it("is one Tab stop, not one per tab", () => {
      renderPage();
      const [first, second] = SETTINGS_TABS.map((t) => screen.getByRole("tab", { name: t.label }));

      expect(first).toHaveAttribute("tabindex", "0");
      expect(second).toHaveAttribute("tabindex", "-1");
    });

    it("names the panel after the tab that selected it", () => {
      renderPage();

      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveAccessibleName(SETTINGS_TABS[0].label);
    });

    // A search spans both tabs and hides the strip, so labelling the results as
    // one tab's panel would name them after a control that isn't on screen.
    it("stops being a tabpanel while a search is spanning both tabs", async () => {
      renderPage();
      await userEvent.type(searchBox(), "trakt");

      expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    });
  });

  it("shows one tab's sections at a time, and the other tab's on request", async () => {
    renderPage();
    expect(onScreen()).toEqual(byTab("preferences").map((s) => s.title));

    await userEvent.click(screen.getByRole("tab", { name: SETTINGS_TABS[1].label }));
    expect(onScreen()).toEqual(byTab("integrations").map((s) => s.title));
  });

  it("opens only the first section of a tab, leaving the rest to be asked for", () => {
    renderPage();
    const expanded = screen.getAllByRole("button", { expanded: true });

    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toHaveAccessibleName(byTab("preferences")[0].title);
  });

  it("titles the page with an h1, so the heading outline starts at the top", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
  });

  it("filters to matching sections, reaching the tab that isn't open", async () => {
    renderPage();
    await userEvent.type(searchBox(), "trakt");

    expect(onScreen()).toEqual(["Sync Status", "Trakt Integration"]);
    expect(tabBar()).not.toBeInTheDocument();
  });

  it("shows a match's body straight away, rather than one more thing to click", async () => {
    renderPage();
    await userEvent.type(searchBox(), "ollama");

    expect(screen.getByText("ai body")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /AI Recommendations/i })).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    renderPage();
    await userEvent.type(searchBox(), "bluray");

    expect(screen.getByRole("status")).toHaveTextContent('No settings match "bluray".');
    expect(onScreen()).toEqual([]);
  });

  it("restores the tab on Escape", async () => {
    renderPage();
    await userEvent.type(searchBox(), "trakt");
    await userEvent.keyboard("{Escape}");

    expect(searchBox()).toHaveValue("");
    expect(tabBar()).toBeInTheDocument();
    expect(onScreen()).toEqual(byTab("preferences").map((s) => s.title));
  });

  it("leads with a count of what is healthy, so the page answers before it is read", async () => {
    health.value = {
      trakt: { tone: "ok", label: "Synced 4m ago" },
      tmdb: { tone: "warn", label: "No key — artwork is off" },
      omdb: { tone: "idle", label: "Not set" },
    };
    renderPage();

    expect(await screen.findByText("1 of 2 sources healthy · 1 not set up")).toBeInTheDocument();
  });

  it("says nothing at all until the statuses land, rather than reporting a health it cannot read", () => {
    renderPage();

    expect(screen.queryByText(/sources healthy/)).not.toBeInTheDocument();
  });

  it("puts each integration's state on its own row, in words as well as in colour", async () => {
    health.value = { trakt: { tone: "bad", label: "Token expired" } };
    renderPage();

    await userEvent.click(screen.getByRole("tab", { name: SETTINGS_TABS[1].label }));
    const header = screen.getByRole("button", { name: /Trakt Integration/ });

    expect(header).toHaveAccessibleName("Trakt Integration Token expired");
    expect(header.querySelector(".status-dot--bad")).not.toBeNull();
  });

  it("groups the integrations by what a source does rather than by who supplies it", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: SETTINGS_TABS[1].label }));

    expect(screen.getByText("Where history comes from")).toBeInTheDocument();
    expect(screen.getByText("Metadata & artwork")).toBeInTheDocument();
    expect(screen.getByText("This server")).toBeInTheDocument();
  });

  it("drops the group headings while searching, where a result set spans all of them", async () => {
    renderPage();
    await userEvent.type(searchBox(), "stremio");

    expect(screen.queryByText("Where history comes from")).not.toBeInTheDocument();
  });

  it("restores the tab from the clear button", async () => {
    renderPage();
    await userEvent.type(searchBox(), "trakt");
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchBox()).toHaveValue("");
    expect(tabBar()).toBeInTheDocument();
    expect(onScreen()).toEqual(byTab("preferences").map((s) => s.title));
  });
});
