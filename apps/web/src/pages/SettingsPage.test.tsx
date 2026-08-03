import { describe, expect, it } from "vitest";
import { INITIALLY_OPEN_SECTION_IDS, SETTINGS_SECTIONS, SETTINGS_TABS, matchesSearch, type SettingsTab } from "./SettingsPage";

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
    expect(find("STREMIO")).toEqual(["addon"]);
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
