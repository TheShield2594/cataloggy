import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, Lock, Pencil, Trash2, Unlock, Users, X } from "lucide-react";
import { api, ApiError, Profile } from "../../api";
import { useProfile } from "../../hooks/useProfile";
import { useToast } from "../../hooks/useToast";

const AVATAR_COLORS = ["#f97316", "#0ea5e9", "#a855f7", "#22c55e", "#ec4899", "#eab308"];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

function RenameForm({ profile, onSaved, onCancel }: { profile: Profile; onSaved: (p: Profile) => void; onCancel: () => void }) {
  const [name, setName] = useState(profile.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === profile.name) return onCancel();
    setSaving(true);
    setError(null);
    try {
      const { profile: updated } = await api.updateProfile(profile.id, { name: trimmed });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-1 items-center gap-2">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
      />
      <button type="submit" disabled={saving} aria-label="Save name" className="flex-none rounded-lg p-1.5 text-emerald-600 hover:bg-[var(--surface-strong)]">
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
      </button>
      <button type="button" onClick={onCancel} aria-label="Cancel rename" className="flex-none rounded-lg p-1.5 hover:bg-[var(--surface-strong)]" style={{ color: "var(--text-mute)" }}>
        <X size={16} />
      </button>
      {error && <p className="w-full text-xs text-rose-600">{error}</p>}
    </form>
  );
}

// Changing or removing an *existing* PIN requires the current one (enforced
// server-side too) — otherwise anyone with the app open could strip another
// profile's PIN protection without ever knowing it, defeating its purpose.
function PinForm({ profile, onSaved, onCancel }: { profile: Profile; onSaved: (p: Profile) => void; onCancel: () => void }) {
  const [pin, setPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = pin.trim();
    if (!trimmed) return;
    if (profile.hasPin && !currentPin.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { profile: updated } = await api.updateProfile(profile.id, {
        pin: trimmed,
        ...(profile.hasPin ? { currentPin: currentPin.trim() } : {}),
      });
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Incorrect current PIN.");
      } else {
        setError(err instanceof Error ? err.message : "Could not set PIN.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-1 flex-wrap items-center gap-2">
      {profile.hasPin && (
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={currentPin}
          onChange={(e) => setCurrentPin(e.target.value)}
          placeholder="Current PIN"
          className="w-full min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
          style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
        />
      )}
      <input
        autoFocus={!profile.hasPin}
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder={profile.hasPin ? "New PIN" : "PIN"}
        className="w-full min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
      />
      <button
        type="submit"
        disabled={saving || !pin.trim() || (profile.hasPin && !currentPin.trim())}
        aria-label="Save PIN"
        className="flex-none rounded-lg p-1.5 text-emerald-600 hover:bg-[var(--surface-strong)] disabled:opacity-50"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
      </button>
      <button type="button" onClick={onCancel} aria-label="Cancel" className="flex-none rounded-lg p-1.5 hover:bg-[var(--surface-strong)]" style={{ color: "var(--text-mute)" }}>
        <X size={16} />
      </button>
      {error && <p className="w-full text-xs text-rose-600">{error}</p>}
    </form>
  );
}

function RemovePinForm({ profile, onSaved, onCancel }: { profile: Profile; onSaved: (p: Profile) => void; onCancel: () => void }) {
  const [currentPin, setCurrentPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = currentPin.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const { profile: updated } = await api.updateProfile(profile.id, { pin: null, currentPin: trimmed });
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Incorrect current PIN.");
      } else {
        setError(err instanceof Error ? err.message : "Could not remove PIN.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-1 items-center gap-2">
      <input
        autoFocus
        type="password"
        inputMode="numeric"
        value={currentPin}
        onChange={(e) => setCurrentPin(e.target.value)}
        placeholder="Current PIN to confirm removal"
        className="w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
      />
      <button type="submit" disabled={saving || !currentPin.trim()} aria-label="Confirm PIN removal" className="flex-none rounded-lg p-1.5 text-emerald-600 hover:bg-[var(--surface-strong)] disabled:opacity-50">
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
      </button>
      <button type="button" onClick={onCancel} aria-label="Cancel" className="flex-none rounded-lg p-1.5 hover:bg-[var(--surface-strong)]" style={{ color: "var(--text-mute)" }}>
        <X size={16} />
      </button>
      {error && <p className="w-full text-xs text-rose-600">{error}</p>}
    </form>
  );
}

function ProfileRow({
  profile,
  isActive,
  isOnlyProfile,
  onUpdated,
  onDeleted,
}: {
  profile: Profile;
  isActive: boolean;
  isOnlyProfile: boolean;
  onUpdated: (p: Profile) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState<"none" | "name" | "pin" | "removePin">("none");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const remove = async () => {
    if (
      !window.confirm(
        `Delete the "${profile.name}" profile? Its watch history, lists, and stats will be permanently deleted.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await api.deleteProfile(profile.id);
      onDeleted(profile.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete profile.");
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}>
      <div className="flex items-center gap-3">
        <span
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: avatarColor(profile.name) }}
        >
          {initials(profile.name)}
        </span>

        {editing === "name" ? (
          <RenameForm
            profile={profile}
            onSaved={(p) => { onUpdated(p); setEditing("none"); }}
            onCancel={() => setEditing("none")}
          />
        ) : editing === "pin" ? (
          <PinForm
            profile={profile}
            onSaved={(p) => { onUpdated(p); setEditing("none"); showToast(`PIN ${profile.hasPin ? "changed" : "set"} for ${p.name}`); }}
            onCancel={() => setEditing("none")}
          />
        ) : editing === "removePin" ? (
          <RemovePinForm
            profile={profile}
            onSaved={(p) => { onUpdated(p); setEditing("none"); showToast(`PIN removed for ${p.name}`); }}
            onCancel={() => setEditing("none")}
          />
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>{profile.name}</span>
              {isActive && (
                <span className="flex-none rounded-full bg-claw-500/10 px-2 py-0.5 text-2xs font-medium text-claw-text">Active</span>
              )}
              {profile.hasPin ? (
                <Lock size={13} className="flex-none" style={{ color: "var(--text-mute)" }} />
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setEditing("name")}
              aria-label={`Rename ${profile.name}`}
              className="flex-none rounded-lg p-1.5 transition-colors hover:bg-[var(--surface-strong)]"
              style={{ color: "var(--text-mute)" }}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={() => setEditing("pin")}
              aria-label={profile.hasPin ? `Change PIN for ${profile.name}` : `Set PIN for ${profile.name}`}
              className="flex-none rounded-lg p-1.5 transition-colors hover:bg-[var(--surface-strong)]"
              style={{ color: "var(--text-mute)" }}
            >
              <Lock size={14} />
            </button>
            {profile.hasPin && (
              <button
                type="button"
                onClick={() => setEditing("removePin")}
                aria-label={`Remove PIN for ${profile.name}`}
                className="flex-none rounded-lg p-1.5 transition-colors hover:bg-[var(--surface-strong)]"
                style={{ color: "var(--text-mute)" }}
              >
                <Unlock size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={remove}
              disabled={deleting || isOnlyProfile}
              title={isOnlyProfile ? "Can't delete the only profile" : "Delete profile"}
              aria-label={`Delete ${profile.name}`}
              className="flex-none rounded-lg p-1.5 transition-colors hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--text-mute)]"
              style={{ color: "var(--text-mute)" }}
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-rose-600"><AlertCircle size={13} /> {error}</p>}
    </div>
  );
}

export function ProfileSettings() {
  const { profile: activeProfile, setProfile: setActiveProfile, openSwitcher } = useProfile();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    void (async () => {
      try {
        const { profiles: fetched } = await api.getProfiles();
        setProfiles(fetched);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profiles");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleUpdated = (updated: Profile) => {
    setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    if (activeProfile?.id === updated.id) setActiveProfile(updated);
  };

  const handleDeleted = (id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    showToast("Profile deleted");
    if (activeProfile?.id === id) {
      // The profile we were using is gone — force re-selection instead of
      // leaving every subsequent API call scoped to a now-nonexistent profile.
      openSwitcher();
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        {activeProfile ? <>Currently watching as <strong>{activeProfile.name}</strong>. </> : null}
        Each profile has its own watch history, lists, and stats. Rename, PIN-protect, or delete profiles below.
      </p>

      <button
        type="button"
        onClick={openSwitcher}
        className="inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2"
        style={{ background: "var(--surface)", borderColor: "var(--border-strong)", color: "var(--text-dim)" }}
      >
        <Users size={16} /> Switch Profile
      </button>

      {loading ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}>
          <Loader2 size={16} className="animate-spin" /> Loading profiles...
        </div>
      ) : error ? (
        <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>
      ) : (
        <div className="space-y-2">
          {profiles.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              isActive={activeProfile?.id === profile.id}
              isOnlyProfile={profiles.length === 1}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}
