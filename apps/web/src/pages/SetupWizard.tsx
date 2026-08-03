import { FormEvent, useState } from "react";
import { Check, Clapperboard, Eye, EyeOff, Loader2, AlertCircle, ArrowRight } from "lucide-react";
import { api, ApiError, runtimeConfig } from "../api";
import { StatusBadge } from "../components/settings/StatusBadge";
import { TraktSettings } from "../components/settings/TraktSettings";

type Step = "token" | "tmdb" | "trakt" | "done";

function WizardShell({ step, children }: { step: Step; children: React.ReactNode }) {
  const steps: Step[] = ["token", "tmdb", "trakt", "done"];
  const index = steps.indexOf(step);

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-claw-500">
            <Clapperboard className="h-6 w-6 text-claw-on" />
          </div>
          <span className="text-2xl font-bold">Cataloggy</span>
        </div>

        <div className="flex items-center justify-center gap-2">
          {steps.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 w-8 rounded-full transition-colors ${i <= index ? "bg-claw-500" : ""}`}
              style={i <= index ? undefined : { backgroundColor: "var(--surface)" }}
            />
          ))}
        </div>

        <div
          className="rounded-2xl p-6 shadow-sm"
          style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-0)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function TokenStep({ onVerified }: { onVerified: (tmdbConfigured: boolean) => void }) {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setVerifying(true);
    setError(null);
    runtimeConfig.setToken(trimmed);

    try {
      const status = await api.getTmdbStatus();
      onVerified(status.configured);
    } catch (err) {
      runtimeConfig.setToken("");
      if (err instanceof ApiError && err.status === 401) {
        setError("That token was rejected by the server. Double-check it and try again.");
      } else {
        setError(err instanceof Error ? err.message : "Could not reach the Cataloggy server.");
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Welcome to Cataloggy</h1>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>
          Enter the API token configured on your Cataloggy server to get started.
        </p>
      </div>
      <div className="relative">
        <input
          autoFocus
          type={showToken ? "text" : "password"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste your API token"
          aria-label="API token"
          className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-0)] px-4 py-3 pr-12 text-sm text-[var(--text)] focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        />
        <button
          type="button"
          onClick={() => setShowToken((p) => !p)}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[var(--text-mute)] transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--text)]"
          aria-label={showToken ? "Hide token" : "Show token"}
        >
          {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && (
        <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>
      )}
      <button
        type="submit"
        disabled={verifying || !token.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-claw-500 px-5 py-3 text-sm font-semibold text-claw-on transition-all hover:bg-claw-600 disabled:opacity-50 shadow-lg shadow-claw-500/20"
      >
        {verifying ? <><Loader2 size={16} className="animate-spin" /> Verifying...</> : <>Continue <ArrowRight size={16} /></>}
      </button>
    </form>
  );
}

function TmdbStep({ configured, onContinue }: { configured: boolean; onContinue: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">TMDB Metadata</h1>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>
          Cataloggy uses TMDB to fetch posters, ratings, and details for movies and shows.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <StatusBadge ok={configured} label={configured ? "Configured" : "Not configured"} />
      </div>

      {!configured && (
        <p className="text-sm text-amber-600 leading-relaxed">
          The server is missing a TMDB API key. Set the <code style={{ color: "var(--text-dim)" }}>TMDB_API_KEY</code>{" "}
          environment variable on your Cataloggy server and restart it. You can continue setup now and
          come back to this later.
        </p>
      )}

      <button
        type="button"
        onClick={onContinue}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-claw-500 px-5 py-3 text-sm font-semibold text-claw-on transition-all hover:bg-claw-600 shadow-lg shadow-claw-500/20"
      >
        Continue <ArrowRight size={16} />
      </button>
    </div>
  );
}

function TraktStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Connect Trakt (optional)</h1>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>
          Sync your watch history and watchlist from Trakt. You can also do this later in Settings.
        </p>
      </div>

      <TraktSettings />

      <button
        type="button"
        onClick={onContinue}
        className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)]"
        style={{ backgroundColor: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
      >
        Continue <ArrowRight size={16} />
      </button>
    </div>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/20">
        <Check className="h-7 w-7 text-emerald-600" />
      </div>
      <div>
        <h1 className="text-lg font-semibold">You're all set</h1>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>
          Start searching for movies and shows to build your catalog.
        </p>
      </div>
      <button
        type="button"
        onClick={onFinish}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-claw-500 px-5 py-3 text-sm font-semibold text-claw-on transition-all hover:bg-claw-600 shadow-lg shadow-claw-500/20"
      >
        Get Started
      </button>
    </div>
  );
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>("token");
  const [tmdbConfigured, setTmdbConfigured] = useState(false);

  return (
    <WizardShell step={step}>
      {step === "token" && (
        <TokenStep
          onVerified={(configured) => {
            setTmdbConfigured(configured);
            setStep("tmdb");
          }}
        />
      )}
      {step === "tmdb" && <TmdbStep configured={tmdbConfigured} onContinue={() => setStep("trakt")} />}
      {step === "trakt" && <TraktStep onContinue={() => setStep("done")} />}
      {step === "done" && <DoneStep onFinish={onComplete} />}
    </WizardShell>
  );
}
