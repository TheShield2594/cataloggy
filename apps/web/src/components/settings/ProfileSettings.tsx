import { runtimeConfig } from "../../api";
import { Users } from "lucide-react";

export function ProfileSettings() {
  const switchProfile = () => {
    runtimeConfig.clearProfileId();
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        Switch to a different profile, or create a new one. Each profile has its own watch history,
        lists, and stats.
      </p>
      <button
        type="button"
        onClick={switchProfile}
        className="inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)]"
        style={{ background: "var(--surface)", borderColor: "var(--border-strong)", color: "var(--text-dim)" }}
      >
        <Users size={16} /> Switch Profile
      </button>
    </div>
  );
}
