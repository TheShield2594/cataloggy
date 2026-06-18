import { runtimeConfig } from "../../api";
import { Users } from "lucide-react";

export function ProfileSettings() {
  const switchProfile = () => {
    runtimeConfig.clearProfileId();
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-600 leading-relaxed">
        Switch to a different profile, or create a new one. Each profile has its own watch history,
        lists, and stats.
      </p>
      <button
        type="button"
        onClick={switchProfile}
        className="inline-flex items-center gap-2 rounded-xl bg-ink-100 border border-ink-200 text-ink-700 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-ink-200"
      >
        <Users size={16} /> Switch Profile
      </button>
    </div>
  );
}
