import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, ArrowRight, Clapperboard, Loader2, Lock, Plus, X } from "lucide-react";
import { api, ApiError, Profile, runtimeConfig } from "../api";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useScrollLock } from "../hooks/useScrollLock";

function Shell({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  // All three gated on `onClose`: without it this renders as a full page
  // (first-run profile setup), not a modal, and must not lock scroll or
  // swallow Escape.
  const isModal = !!onClose;
  const dialogRef = useFocusTrap<HTMLDivElement>(isModal);
  useScrollLock(isModal);
  useEscapeKey(() => onClose?.(), isModal);

  if (onClose) {
    return (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-6 py-12"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Switch profile"
      >
        <div ref={dialogRef} tabIndex={-1} className="w-full max-w-md space-y-6" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-claw-500">
              <Clapperboard className="h-6 w-6 text-claw-on" />
            </div>
            <span className="text-2xl font-bold" style={{ color: "var(--text)" }}>Cataloggy</span>
          </div>

          <div className="relative rounded-2xl border p-6 shadow-sm" style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
              style={{ color: "var(--text-mute)" }}
            >
              <X className="h-4 w-4" />
            </button>
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-claw-500">
            <Clapperboard className="h-6 w-6 text-claw-on" />
          </div>
          <span className="text-2xl font-bold" style={{ color: "var(--text)" }}>Cataloggy</span>
        </div>

        <div className="rounded-2xl border p-6 shadow-sm" style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function CreateProfileForm({
  title,
  subtitle,
  onCreated,
  onCancel,
}: {
  title: string;
  subtitle: string;
  onCreated: (profile: Profile) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setCreating(true);
    setError(null);
    try {
      const { profile } = await api.createProfile({
        name: trimmedName,
        pin: pin.trim() || undefined,
      });
      onCreated(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create profile.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{title}</h2>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>{subtitle}</p>
      </div>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Profile name"
        className="w-full rounded-xl border px-4 py-3 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
      />
      <input
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder="PIN (optional)"
        className="w-full rounded-xl border px-4 py-3 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
      />
      {error && (
        <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>
      )}
      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border px-5 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)]"
            style={{ borderColor: "var(--border)", color: "var(--text-dim)", background: "var(--bg-1)" }}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-claw-500 px-5 py-3 text-sm font-semibold text-claw-on transition-all hover:bg-claw-600 disabled:opacity-50"
        >
          {creating ? <><Loader2 size={16} className="animate-spin" /> Creating...</> : <>Create <ArrowRight size={16} /></>}
        </button>
      </div>
    </form>
  );
}

function PinPrompt({
  profile,
  onVerified,
  onBack,
}: {
  profile: Profile;
  onVerified: (profile: Profile) => void;
  onBack: () => void;
}) {
  const [pin, setPin] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    setError(null);
    try {
      const result = await api.verifyProfile(profile.id, pin.trim());
      onVerified({ id: result.id, name: result.name, hasPin: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Incorrect PIN.");
      } else {
        setError(err instanceof Error ? err.message : "Could not verify PIN.");
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Enter PIN for {profile.name}</h2>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>This profile is PIN-protected.</p>
      </div>
      <input
        autoFocus
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder="PIN"
        className="w-full rounded-xl border px-4 py-3 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
      />
      {error && (
        <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-xl border px-5 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)]"
          style={{ borderColor: "var(--border)", color: "var(--text-dim)", background: "var(--bg-1)" }}
        >
          Back
        </button>
        <button
          type="submit"
          disabled={verifying || !pin.trim()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-claw-500 px-5 py-3 text-sm font-semibold text-claw-on transition-all hover:bg-claw-600 disabled:opacity-50"
        >
          {verifying ? <Loader2 size={16} className="animate-spin" /> : <>Unlock <ArrowRight size={16} /></>}
        </button>
      </div>
    </form>
  );
}

const AVATAR_COLORS = ["#f97316", "#0ea5e9", "#a855f7", "#22c55e", "#ec4899", "#eab308"];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

function ProfilePicker({
  profiles,
  onSelect,
  onCreateNew,
}: {
  profiles: Profile[];
  onSelect: (profile: Profile) => void;
  onCreateNew: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Who's watching?</h2>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>Choose a profile to continue.</p>
      </div>
      <div className="space-y-2">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            onClick={() => onSelect(profile)}
            className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors hover:border-claw-500/60 hover:bg-[var(--surface)]"
            style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
          >
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: avatarColor(profile.name) }}
            >
              {initials(profile.name)}
            </span>
            <span className="flex-1">{profile.name}</span>
            {profile.hasPin && <Lock className="h-4 w-4" style={{ color: "var(--text-mute)" }} />}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCreateNew}
        className="flex w-full items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)]"
        style={{ borderColor: "var(--border)", color: "var(--text-dim)", background: "var(--bg-1)" }}
      >
        <Plus size={16} /> New Profile
      </button>
    </div>
  );
}

export function ProfileSwitcher({ onSelected, onClose }: { onSelected: (profile: Profile) => void; onClose?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"picker" | "create" | "pin">("picker");
  const [pinTarget, setPinTarget] = useState<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { profiles: fetched } = await api.getProfiles();
        if (cancelled) return;
        setProfiles(fetched);
        setMode(fetched.length === 0 ? "create" : "picker");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load profiles.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectProfile = async (profile: Profile) => {
    if (profile.hasPin) {
      setPinTarget(profile);
      setMode("pin");
      return;
    }
    try {
      const result = await api.verifyProfile(profile.id);
      runtimeConfig.setProfileId(result.id);
      onSelected({ id: result.id, name: result.name, hasPin: profile.hasPin });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not select profile.");
    }
  };

  if (loading) {
    return (
      <Shell onClose={onClose}>
        <div className="flex items-center justify-center gap-2 py-6 text-sm" style={{ color: "var(--text-mute)" }}>
          <Loader2 size={16} className="animate-spin" /> Loading profiles...
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell onClose={onClose}>
        <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      {mode === "picker" && (
        <ProfilePicker profiles={profiles} onSelect={selectProfile} onCreateNew={() => setMode("create")} />
      )}
      {mode === "create" && (
        <CreateProfileForm
          title={profiles.length === 0 ? "Create your first profile" : "New Profile"}
          subtitle="Each profile gets its own watch history, lists, and stats."
          onCreated={(profile) => {
            runtimeConfig.setProfileId(profile.id);
            onSelected(profile);
          }}
          onCancel={profiles.length > 0 ? () => setMode("picker") : undefined}
        />
      )}
      {mode === "pin" && pinTarget && (
        <PinPrompt
          profile={pinTarget}
          onVerified={(profile) => {
            runtimeConfig.setProfileId(profile.id);
            onSelected(profile);
          }}
          onBack={() => setMode("picker")}
        />
      )}
    </Shell>
  );
}
