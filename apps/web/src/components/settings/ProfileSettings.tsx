import { Users } from "lucide-react";
import { useProfile } from "../../hooks/useProfile";

export function ProfileSettings() {
  const { profile, openSwitcher } = useProfile();

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        {profile ? <>Currently watching as <strong>{profile.name}</strong>. </> : null}
        Switch to a different profile, or create a new one. Each profile has its own watch history,
        lists, and stats.
      </p>
      <button
        type="button"
        onClick={openSwitcher}
        className="inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2"
        style={{ background: "var(--surface)", borderColor: "var(--border-strong)", color: "var(--text-dim)" }}
      >
        <Users size={16} /> Switch Profile
      </button>
    </div>
  );
}
