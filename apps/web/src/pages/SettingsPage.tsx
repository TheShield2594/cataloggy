import { ReactNode, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Key, Link, Database, Info, Clapperboard, Film, Image, Globe, Star, Sparkles, Bell, Users, Activity, Search, X } from "lucide-react";
import { Section } from "../components/settings/Section";
import { ApiTokenSettings } from "../components/settings/ApiTokenSettings";
import { TraktSettings } from "../components/settings/TraktSettings";
import { TmdbSettings } from "../components/settings/TmdbSettings";
import { OmdbSettings } from "../components/settings/OmdbSettings";
import { RpdbSettings } from "../components/settings/RpdbSettings";
import { AddonSettings } from "../components/settings/AddonSettings";
import { StremioSyncSettings } from "../components/settings/StremioSyncSettings";
import { PlayDetectionSettings } from "../components/settings/PlayDetectionSettings";
import { AiSettings } from "../components/settings/AiSettings";
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
  {
    id: "api-token",
    tab: "integrations",
    title: "API Token",
    icon: <Key size={20} />,
    keywords: "auth authentication bearer secret credentials",
    content: <ApiTokenSettings />,
  },
  {
    id: "tmdb",
    tab: "integrations",
    title: "TMDB Metadata",
    icon: <Film size={20} />,
    keywords: "the movie database api key posters metadata artwork cast",
    content: <TmdbSettings />,
  },
  {
    id: "trakt",
    tab: "integrations",
    title: "Trakt Integration",
    icon: <Link size={20} />,
    keywords: "scrobble import watchlist history oauth sync",
    content: <TraktSettings />,
  },
  {
    id: "addon",
    tab: "integrations",
    title: "Stremio Addon",
    icon: <Clapperboard size={20} />,
    keywords: "stremio catalogs manifest install url",
    content: <AddonSettings />,
  },
  {
    id: "stremio-sync",
    tab: "integrations",
    title: "Stremio Watched Sync",
    icon: <Clapperboard size={20} />,
    keywords: "stremio watched history sync library account import scrobble",
    content: <StremioSyncSettings />,
  },
  {
    id: "play-detection",
    tab: "integrations",
    title: "Play Detection",
    icon: <Activity size={20} />,
    keywords: "stremio vidi omni nuvio addon apps automatic watched inferred signals",
    content: <PlayDetectionSettings />,
  },
  {
    id: "omdb",
    tab: "integrations",
    title: "OMDB Ratings",
    icon: <Star size={20} />,
    keywords: "imdb rotten tomatoes metacritic scores api key",
    content: <OmdbSettings />,
  },
  {
    id: "rpdb",
    tab: "integrations",
    title: "RPDB Posters",
    icon: <Image size={20} />,
    keywords: "rating poster database artwork images api key",
    content: <RpdbSettings />,
  },
  {
    id: "ai",
    tab: "integrations",
    title: "AI Recommendations",
    icon: <Sparkles size={20} />,
    keywords: "llm openai ollama model provider suggestions",
    content: <AiSettings />,
  },
  {
    id: "data",
    tab: "integrations",
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

  const visible = useMemo(
    () => (searching ? SETTINGS_SECTIONS.filter((s) => matchesSearch(s, query)) : SETTINGS_SECTIONS.filter((s) => s.tab === tab)),
    [query, searching, tab]
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className={PAGE_TITLE}>Settings</h1>

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
        <div
          className="flex rounded-full p-1"
          style={{ border: "1px solid var(--border)", backgroundColor: "var(--surface)" }}
        >
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-base ${
                tab === t.id
                  ? "bg-claw-500 text-claw-on shadow-glow"
                  : "text-[var(--text-dim)] hover:text-[var(--text)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {visible.map((section) => (
          <Section
            key={section.id}
            title={section.title}
            icon={section.icon}
            storageKey={section.id}
            defaultOpen={INITIALLY_OPEN_SECTION_IDS.has(section.id)}
            alwaysOpen={searching}
          >
            {section.content}
          </Section>
        ))}
      </div>
    </div>
  );
}
