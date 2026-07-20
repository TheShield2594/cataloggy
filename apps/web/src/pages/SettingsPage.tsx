import { useSearchParams } from "react-router-dom";
import { Key, Link, Database, Info, Clapperboard, Image, Globe, Star, Sparkles, Bell, Users, Activity } from "lucide-react";
import { Section } from "../components/settings/Section";
import { ApiTokenSettings } from "../components/settings/ApiTokenSettings";
import { TraktSettings } from "../components/settings/TraktSettings";
import { OmdbSettings } from "../components/settings/OmdbSettings";
import { RpdbSettings } from "../components/settings/RpdbSettings";
import { AddonSettings } from "../components/settings/AddonSettings";
import { AiSettings } from "../components/settings/AiSettings";
import { DataSettings } from "../components/settings/DataSettings";
import { PreferencesSettings } from "../components/settings/PreferencesSettings";
import { PushSettings } from "../components/settings/PushSettings";
import { ProfileSettings } from "../components/settings/ProfileSettings";
import { JobStatusSettings } from "../components/settings/JobStatusSettings";

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown";

type SettingsTab = "preferences" | "integrations";

function isSettingsTab(value: string | null): value is SettingsTab {
  return value === "preferences" || value === "integrations";
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: SettingsTab = isSettingsTab(searchParams.get("tab")) ? (searchParams.get("tab") as SettingsTab) : "preferences";

  const setTab = (next: SettingsTab) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("tab", next);
      return params;
    });
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "preferences", label: "Preferences" },
    { id: "integrations", label: "Integrations & Advanced" },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">Settings</h2>

      <div
        className="flex rounded-full p-1"
        style={{ border: "1px solid var(--border)", backgroundColor: "var(--surface)" }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
              tab === t.id
                ? "bg-claw-500 text-white shadow-lg shadow-claw-500/25"
                : "text-[var(--text-dim)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "preferences" && (
        <div className="space-y-4">
          <Section title="Preferences" icon={<Globe size={20} />} storageKey="preferences">
            <PreferencesSettings />
          </Section>

          <Section title="Profile" icon={<Users size={20} />} storageKey="profile">
            <ProfileSettings />
          </Section>

          <Section title="Notifications" icon={<Bell size={20} />} storageKey="notifications">
            <PushSettings />
          </Section>

          <Section title="Sync Status" icon={<Activity size={20} />} storageKey="job-status" defaultOpen={false}>
            <JobStatusSettings />
          </Section>

          <Section title="About" icon={<Info size={20} />} storageKey="about">
            <div className="space-y-2 text-sm" style={{ color: "var(--text-dim)" }}>
              <p className="text-base font-semibold" style={{ color: "var(--text)" }}>Cataloggy <span className="font-mono text-claw-600">v{APP_VERSION}</span></p>
              <p className="text-sm">A personal media catalog and watchlist manager.</p>
              <p className="text-2xs" style={{ color: "var(--text-mute)" }}>Cataloggy &middot; Personal Media Tracker</p>
            </div>
          </Section>
        </div>
      )}

      {tab === "integrations" && (
        <div className="space-y-4">
          <Section title="API Token" icon={<Key size={20} />} storageKey="api-token">
            <ApiTokenSettings />
          </Section>

          <Section title="Trakt Integration" icon={<Link size={20} />} storageKey="trakt">
            <TraktSettings />
          </Section>

          <Section title="Stremio Addon" icon={<Clapperboard size={20} />} storageKey="addon">
            <AddonSettings />
          </Section>

          <Section title="OMDB Ratings" icon={<Star size={20} />} storageKey="omdb">
            <OmdbSettings />
          </Section>

          <Section title="RPDB Posters" icon={<Image size={20} />} storageKey="rpdb">
            <RpdbSettings />
          </Section>

          <Section title="AI Recommendations" icon={<Sparkles size={20} />} storageKey="ai">
            <AiSettings />
          </Section>

          <Section title="Data" icon={<Database size={20} />} storageKey="data">
            <DataSettings />
          </Section>
        </div>
      )}
    </div>
  );
}
