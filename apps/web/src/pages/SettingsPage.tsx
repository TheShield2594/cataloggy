import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Key, Link, Database, Download, Info, Clapperboard, Film, Image, Globe, Star, Sparkles, Bell, Users, Activity, Search, X } from "lucide-react";
import { Section } from "../components/settings/Section";
import { healthSummary } from "../components/settings/health";
import { useSettingsHealth } from "../hooks/useSettingsHealth";
import { ApiTokenSettings } from "../components/settings/ApiTokenSettings";
import { TraktSettings } from "../components/settings/TraktSettings";
import { TmdbSettings } from "../components/settings/TmdbSettings";
import { OmdbSettings } from "../components/settings/OmdbSettings";
import { RpdbSettings } from "../components/settings/RpdbSettings";
import { AddonSettings } from "../components/settings/AddonSettings";
import { StremioSyncSettings } from "../components/settings/StremioSyncSettings";
import { PlayDetectionSettings } from "../components/settings/PlayDetectionSettings";
import { AiSettings } from "../components/settings/AiSettings";
import { JellyseerrSettings } from "../components/settings/JellyseerrSettings";
import { DataSettings } from "../components/settings/DataSettings";
import { PreferencesSettings } from "../components/settings/PreferencesSettings";
import { PushSettings } from "../components/settings/PushSettings";
import { NotificationChannelsSettings } from "../components/settings/NotificationChannelsSettings";
import { ProfileSettings } from "../components/settings/ProfileSettings";
import { JobStatusSettings } from "../components/settings/JobStatusSettings";
import { PAGE_TITLE } from "../components/typography";

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown";

export type SettingsTab = "preferences" | "integrations";

export type SettingsSection = {
  /** Also the key `Section` persists its open/closed state under. */
  id: string;
  tab: SettingsTab;
  /**
   * The eyebrow this section sits under, grouping the tab by what a thing does
   * rather than by which vendor supplies it — "where history comes from" is a
   * question someone actually has; "Trakt, Stremio, TMDB, OMDB" in a flat list
   * is not an answer to it. Sections in the same group have to be adjacent in
   * this array; the renderer prints a heading when the group changes.
   */
  group?: string;
  title: string;
  icon: ReactNode;
  /** Extra terms the section should be findable by; the title is always searched. */
  keywords: string;
  content: ReactNode;
};

function AboutSection() {
  return (
    <div className="space-y-2 text-sm" style={{ color: "var(--text-dim)" }}>
      <p className="text-base font-semibold" style={{ color: "var(--text)" }}>Cataloggy <span className="font-mono text-claw-text">v{APP_VERSION}</span></p>
      <p className="text-sm">A personal media catalog and watchlist manager.</p>
      <p className="text-2xs" style={{ color: "var(--text-mute)" }}>Cataloggy &middot; Personal Media Tracker</p>
    </div>
  );
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "preferences",
    tab: "preferences",
    title: "Metadata & Region",
    icon: <Globe size={20} />,
    keywords: "language locale translation streaming region country spoiler protection tmdb metadata",
    content: <PreferencesSettings />,
  },
  {
    id: "profile",
    tab: "preferences",
    title: "Profile",
    icon: <Users size={20} />,
    keywords: "profiles users household switch rename pin lock delete",
    content: <ProfileSettings />,
  },
  {
    id: "notifications",
    tab: "preferences",
    title: "Notifications",
    icon: <Bell size={20} />,
    keywords: "push alerts episode reminders subscribe browser ntfy gotify discord webhook channels",
    content: (
      <div className="space-y-6">
        <PushSettings />
        <div className="border-t pt-6" style={{ borderColor: "var(--border)" }}>
          <NotificationChannelsSettings />
        </div>
      </div>
    ),
  },
  {
    id: "job-status",
    tab: "preferences",
    title: "Sync Status",
    icon: <Activity size={20} />,
    keywords: "background jobs scheduled sync failures errors trakt steam scrobble",
    content: <JobStatusSettings />,
  },
  {
    id: "about",
    tab: "preferences",
    title: "About",
    icon: <Info size={20} />,
    keywords: "version build release cataloggy",
    content: <AboutSection />,
  },
  // Where history comes from. These lead the tab because they are what the
  // page is usually opened to check: everything below is configuration, and
  // these are the ones that can quietly stop working.
  {
    id: "trakt",
    tab: "integrations",
    group: "Where history comes from",
    title: "Trakt Integration",
    icon: <Link size={20} />,
    keywords: "scrobble import watchlist history oauth sync",
    content: <TraktSettings />,
  },
  {
    id: "stremio-sync",
    tab: "integrations",
    group: "Where history comes from",
    title: "Stremio Watched Sync",
    icon: <Clapperboard size={20} />,
    keywords: "stremio watched history sync library account import scrobble",
    content: <StremioSyncSettings />,
  },
  {
    id: "play-detection",
    tab: "integrations",
    group: "Where history comes from",
    title: "Play Detection",
    icon: <Activity size={20} />,
    keywords: "stremio vidi omni nuvio addon apps automatic watched inferred signals",
    content: <PlayDetectionSettings />,
  },
  // What titles look like once they arrive.
  {
    id: "tmdb",
    tab: "integrations",
    group: "Metadata & artwork",
    title: "TMDB Metadata",
    icon: <Film size={20} />,
    keywords: "the movie database api key posters metadata artwork cast",
    content: <TmdbSettings />,
  },
  {
    id: "omdb",
    tab: "integrations",
    group: "Metadata & artwork",
    title: "OMDB Ratings",
    icon: <Star size={20} />,
    keywords: "imdb rotten tomatoes metacritic scores api key",
    content: <OmdbSettings />,
  },
  {
    id: "rpdb",
    tab: "integrations",
    group: "Metadata & artwork",
    title: "RPDB Posters",
    icon: <Image size={20} />,
    keywords: "rating poster database artwork images api key",
    content: <RpdbSettings />,
  },
  // The one integration that points outward: everything above answers "what
  // have I watched" or "what is this thing"; this one acts on the answer.
  {
    id: "jellyseerr",
    tab: "integrations",
    group: "Where titles go",
    title: "Jellyseerr Requests",
    icon: <Download size={20} />,
    keywords: "jellyseerr overseerr request sonarr radarr download watchlist acquire",
    content: <JellyseerrSettings />,
  },
  // The app's own surfaces and the keys that reach them.
  {
    id: "addon",
    tab: "integrations",
    group: "This server",
    title: "Stremio Addon",
    icon: <Clapperboard size={20} />,
    keywords: "stremio catalogs manifest install url",
    content: <AddonSettings />,
  },
  {
    id: "api-token",
    tab: "integrations",
    group: "This server",
    title: "API Token",
    icon: <Key size={20} />,
    keywords: "auth authentication bearer secret credentials",
    content: <ApiTokenSettings />,
  },
  {
    id: "ai",
    tab: "integrations",
    group: "This server",
    title: "AI Recommendations",
    icon: <Sparkles size={20} />,
    keywords: "llm openai ollama model provider suggestions",
    content: <AiSettings />,
  },
  {
    id: "data",
    tab: "integrations",
    group: "This server",
    title: "Data",
    icon: <Database size={20} />,
    keywords: "export import backup restore refresh metadata steam wipe",
    content: <DataSettings />,
  },
];

/**
 * The one section per tab that starts expanded. Everything else opens on demand,
 * so a first visit is a scannable list rather than twelve stacked forms.
 */
export const INITIALLY_OPEN_SECTION_IDS = new Set(
  SETTINGS_SECTIONS.filter((section, index) => SETTINGS_SECTIONS.findIndex((s) => s.tab === section.tab) === index).map((s) => s.id)
);

/** Every whitespace-separated term has to appear in the title or keywords. */
export function matchesSearch(section: SettingsSection, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${section.title} ${section.keywords}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "preferences", label: "Preferences" },
  { id: "integrations", label: "Integrations & Data" },
];

function isSettingsTab(value: string | null): value is SettingsTab {
  return value === "preferences" || value === "integrations";
}

export function SettingsPage() {
  // `sections` is shared with the rail, which shows the same dots against its
  // Sources rows — see the provider note in useSettingsHealth. It is read once
  // for the tab and re-asked here, because this page is the status board: a
  // reader who navigated to it deliberately is owed what is true now, not what
  // was true when the app started.
  const { sections: health, refresh: refreshHealth } = useSettingsHealth();
  useEffect(() => { refreshHealth(); }, [refreshHealth]);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: SettingsTab = isSettingsTab(searchParams.get("tab")) ? (searchParams.get("tab") as SettingsTab) : "preferences";
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const setTab = (next: SettingsTab) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("tab", next);
      return params;
    });
  };

  const tabsId = useId();
  const tablistRef = useRef<HTMLDivElement>(null);

  // Automatic activation — arrow moves focus and selects in one step, which the
  // pattern recommends when switching panels is cheap, and these two are just a
  // filter over a list already in memory. Focus is moved by hand because the
  // roving tabindex means the newly selected tab is the only one that can hold
  // it, and it does not get it merely by being re-rendered.
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const deltas: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const current = SETTINGS_TABS.findIndex((t) => t.id === tab);
    const delta = deltas[event.key];
    let nextIndex: number;
    if (delta !== undefined) nextIndex = (current + delta + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = SETTINGS_TABS.length - 1;
    else return;

    // The arithmetic above stays in range, so this is the checker's question
    // rather than a real one — but answering it before `preventDefault` means a
    // key that somehow lands outside still does what the browser would.
    const nextTab = SETTINGS_TABS[nextIndex];
    if (!nextTab) return;

    event.preventDefault();
    setTab(nextTab.id);
    tablistRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus();
  };

  const visible = useMemo(
    () => (searching ? SETTINGS_SECTIONS.filter((s) => matchesSearch(s, query)) : SETTINGS_SECTIONS.filter((s) => s.tab === tab)),
    [query, searching, tab]
  );

  // Empty until the status requests land, and empty again if every one of them
  // failed — in which case saying nothing is right, because the alternative is
  // reporting a health the page could not actually read.
  const summary = healthSummary(health);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className={PAGE_TITLE}>Settings</h1>
        {/*
         * Health first. Every number here was already in the app — one level
         * inside the Sync Status section and inside each integration's own
         * panel — which is to say it was everywhere except where someone
         * wondering "is this working?" would look.
         *
         * A polite live region because it arrives a moment after the page: six
         * status requests resolve together, and a screen reader that has
         * already moved on should hear the answer rather than have it appear
         * silently behind it.
         */}
        {summary && (
          <p role="status" className="meta-row mt-1.5" style={{ color: "var(--text-mute)" }}>
            {summary}
          </p>
        )}
      </div>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "var(--text-mute)" }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="Search settings..."
          aria-label="Search settings"
          className="w-full rounded-full py-2.5 pl-11 pr-11 text-sm placeholder:text-[var(--text-mute)] focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15 transition-all duration-base"
          style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border-strong)", background: "var(--bg-0)", color: "var(--text)" }}
        />
        {searching && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 transition-colors hover:bg-[var(--surface-strong)]"
            style={{ color: "var(--text-mute)" }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {searching ? (
        <p role="status" className="text-sm tabular-nums" style={{ color: "var(--text-dim)" }}>
          {visible.length === 0
            ? `No settings match "${query.trim()}".`
            : `${visible.length} ${visible.length === 1 ? "section" : "sections"} across both tabs.`}
        </p>
      ) : (
        // A real tablist rather than two buttons whose selected state is a
        // background colour. The ARIA tabs pattern is a promise of arrow-key
        // navigation and a roving tabindex, so both are implemented below —
        // announcing the role without them is the mistake ListsSection's
        // `role="menu"` made.
        // The segmented control's shape, and this strip's own semantics. It
        // borrows `.segmented` from index.css — the track, the raised sliding
        // thumb, the type — but stays a real `tablist` with the roving tabindex
        // and arrow keys the role promises, which the shared `SegmentedControl`
        // component deliberately does not claim.
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Settings sections"
          className="segmented max-w-md"
        >
          <span
            aria-hidden="true"
            className="segmented-thumb"
            style={{
              width: `calc((100% - 4px) / ${SETTINGS_TABS.length})`,
              transform: `translateX(${SETTINGS_TABS.findIndex((t) => t.id === tab) * 100}%)`,
            }}
          />
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${tabsId}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${tabsId}-panel`}
              // Roving tabindex: the tablist is one Tab stop, and the arrow keys
              // move within it.
              tabIndex={tab === t.id ? 0 : -1}
              // On the tabs rather than on the tablist. Key events bubble, so
              // either works; only the focusable element carrying its own
              // handler is a shape jsx-a11y can recognise as a keyboard-operable
              // control, and only one tab is focusable at a time anyway.
              onKeyDown={onTabKeyDown}
              onClick={() => setTab(t.id)}
              className="segmented-option truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Only a tabpanel while the tablist above is the thing selecting it. A
          search spans both tabs, so labelling the results as one tab's panel
          would name them after a control that isn't on screen. */}
      <div
        className="space-y-4"
        {...(searching
          ? {}
          : { role: "tabpanel", id: `${tabsId}-panel`, "aria-labelledby": `${tabsId}-tab-${tab}` })}
      >
        {visible.map((section, index) => (
          <div key={section.id} className="space-y-4">
            {/* A heading only where the group changes, and never while
                searching — results span both tabs and every group, so a run of
                one-section headings would be noise rather than structure. */}
            {!searching && section.group && section.group !== visible[index - 1]?.group && (
              <p className={index === 0 ? "eyebrow" : "eyebrow pt-3"}>{section.group}</p>
            )}
            <Section
              title={section.title}
              icon={section.icon}
              storageKey={section.id}
              defaultOpen={INITIALLY_OPEN_SECTION_IDS.has(section.id)}
              alwaysOpen={searching}
              health={health[section.id]}
            >
              {section.content}
            </Section>
          </div>
        ))}
      </div>
    </div>
  );
}
