import { FormEvent, useState } from "react";
import { Check, Eye, EyeOff, Loader2, AlertCircle, ArrowLeft, ArrowRight } from "lucide-react";
import { api, ApiError, runtimeConfig } from "../api";
import { BrandLockup } from "../components/BrandMark";
import { TmdbSettings } from "../components/settings/TmdbSettings";
import { TraktSettings } from "../components/settings/TraktSettings";
import { SECTION_TITLE } from "../components/typography";

type Step = "token" | "tmdb" | "trakt" | "done";

export const WIZARD_STEPS: Step[] = ["token", "tmdb", "trakt", "done"];

/** The step to return to from `step`, or null if it is the entry point. */
export function previousStep(step: Step): Step | null {
  const index = WIZARD_STEPS.indexOf(step);
  return index > 0 ? WIZARD_STEPS[index - 1] : null;
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="btn-secondary btn-lg w-full"
    >
      <ArrowLeft size={16} /> Back
    </button>
  );
}

function WizardShell({ step, children }: { step: Step; children: React.ReactNode }) {
  const index = WIZARD_STEPS.indexOf(step);
  const position = index + 1;
  const total = WIZARD_STEPS.length;
  const label = `Step ${position} of ${total}`;

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <BrandLockup />

        {/* The bars alone say nothing to a screen reader and give no sense of
            how much is left to anyone else, so the count carries the meaning
            and the bars are decoration on top of it. */}
        <div className="space-y-2">
          <div
            className="flex items-center justify-center gap-2"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={position}
            aria-valuetext={label}
          >
            {WIZARD_STEPS.map((s, i) => (
              <span
                key={s}
                className={`h-1.5 w-8 rounded-full transition-colors ${i <= index ? "bg-claw-500" : ""}`}
                style={i <= index ? undefined : { backgroundColor: "var(--surface)" }}
              />
            ))}
          </div>
          <p className="text-center text-xs font-medium" style={{ color: "var(--text-mute)" }} aria-hidden="true">
            {label}
          </p>
        </div>

        <div
          className="rounded-2xl p-6 shadow-e1"
          style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-0)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function TokenStep({ onVerified }: { onVerified: () => void }) {
  // Prefilled so stepping back from tmdb lands on the token that got you here,
  // ready to be corrected rather than retyped from scratch.
  const [token, setToken] = useState(() => runtimeConfig.getToken());
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
      // Any authenticated endpoint would do — this one is cheap and the next
      // step needs the server reachable anyway.
      await api.getTmdbStatus();
      onVerified();
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
        {/* Not "Welcome to Cataloggy": the lockup above already says the name,
            and a step's heading is better spent saying what the step wants. */}
        <h1 className={SECTION_TITLE}>Connect your server</h1>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>
          Paste the API token your server was configured with to get started.
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
        <p role="alert" className="flex items-center gap-2 text-sm text-danger"><AlertCircle size={16} /> {error}</p>
      )}
      <button
        type="submit"
        disabled={verifying || !token.trim()}
        className="btn-primary btn-lg w-full"
      >
        {verifying ? <><Loader2 size={16} className="animate-spin" /> Verifying...</> : <>Continue <ArrowRight size={16} /></>}
      </button>
    </form>
  );
}

function TmdbStep({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className={SECTION_TITLE}>TMDB Metadata</h1>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>
          Add a key now, or skip and add one later in Settings.
        </p>
      </div>

      <TmdbSettings />

      <button
        type="button"
        onClick={onContinue}
        className="btn-secondary btn-lg w-full"
      >
        Continue <ArrowRight size={16} />
      </button>
      <BackButton onBack={onBack} />
    </div>
  );
}

function TraktStep({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className={SECTION_TITLE}>Connect Trakt (optional)</h1>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>
          Sync your watch history and watchlist from Trakt. You can also do this later in Settings.
        </p>
      </div>

      <TraktSettings />

      <button
        type="button"
        onClick={onContinue}
        className="btn-secondary btn-lg w-full"
      >
        Continue <ArrowRight size={16} />
      </button>
      <BackButton onBack={onBack} />
    </div>
  );
}

function DoneStep({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/20">
        <Check className="h-7 w-7 text-success" />
      </div>
      <div>
        <h1 className={SECTION_TITLE}>You're all set</h1>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>
          Start searching for movies and shows to build your catalog.
        </p>
      </div>
      <button
        type="button"
        onClick={onFinish}
        className="btn-primary btn-lg w-full"
      >
        Get Started
      </button>
      <BackButton onBack={onBack} />
    </div>
  );
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>("token");

  // Every step past the first is reachable in both directions: a token that
  // verified against the wrong server, or a Trakt connection started by
  // mistake, was otherwise only undoable by clearing localStorage.
  const goBack = () => setStep((current) => previousStep(current) ?? current);

  return (
    <WizardShell step={step}>
      {step === "token" && <TokenStep onVerified={() => setStep("tmdb")} />}
      {step === "tmdb" && <TmdbStep onContinue={() => setStep("trakt")} onBack={goBack} />}
      {step === "trakt" && <TraktStep onContinue={() => setStep("done")} onBack={goBack} />}
      {step === "done" && <DoneStep onFinish={onComplete} onBack={goBack} />}
    </WizardShell>
  );
}
