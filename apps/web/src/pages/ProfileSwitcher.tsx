import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, ArrowRight, Clapperboard, Loader2, Lock, Plus, User } from "lucide-react";
import { api, ApiError, Profile, runtimeConfig } from "../api";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-claw-500">
            <Clapperboard className="h-6 w-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-ink-900">Cataloggy</span>
        </div>

        <div className="rounded-2xl border border-ink-100 bg-white p-6 shadow-sm">
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
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
        <p className="mt-1 text-sm text-ink-500 leading-relaxed">{subtitle}</p>
      </div>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Profile name"
        className="w-full rounded-xl border border-ink-100 bg-cream-50 px-4 py-3 text-sm text-ink-900 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
      />
      <input
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder="PIN (optional)"
        className="w-full rounded-xl border border-ink-100 bg-cream-50 px-4 py-3 text-sm text-ink-900 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
      />
      {error && (
        <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>
      )}
      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-ink-100 bg-white px-5 py-3 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-100"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-claw-500 px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-claw-600 disabled:opacity-50"
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
        <h2 className="text-lg font-semibold text-ink-900">Enter PIN for {profile.name}</h2>
        <p className="mt-1 text-sm text-ink-500 leading-relaxed">This profile is PIN-protected.</p>
      </div>
      <input
        autoFocus
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder="PIN"
        className="w-full rounded-xl border border-ink-100 bg-cream-50 px-4 py-3 text-sm text-ink-900 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
      />
      {error && (
        <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-xl border border-ink-100 bg-white px-5 py-3 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-100"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={verifying || !pin.trim()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-claw-500 px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-claw-600 disabled:opacity-50"
        >
          {verifying ? <Loader2 size={16} className="animate-spin" /> : <>Unlock <ArrowRight size={16} /></>}
        </button>
      </div>
    </form>
  );
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
        <h2 className="text-lg font-semibold text-ink-900">Who's watching?</h2>
        <p className="mt-1 text-sm text-ink-500 leading-relaxed">Choose a profile to continue.</p>
      </div>
      <div className="space-y-2">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            onClick={() => onSelect(profile)}
            className="flex w-full items-center gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3 text-left text-sm font-medium text-ink-900 transition-colors hover:border-claw-500/60 hover:bg-cream-50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-100">
              <User className="h-4 w-4 text-ink-600" />
            </span>
            <span className="flex-1">{profile.name}</span>
            {profile.hasPin && <Lock className="h-4 w-4 text-ink-400" />}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCreateNew}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-100 bg-white px-5 py-3 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-100"
      >
        <Plus size={16} /> New Profile
      </button>
    </div>
  );
}

export function ProfileSwitcher({ onSelected }: { onSelected: (profile: Profile) => void }) {
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
      <Shell>
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-ink-500">
          <Loader2 size={16} className="animate-spin" /> Loading profiles...
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>
      </Shell>
    );
  }

  return (
    <Shell>
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
