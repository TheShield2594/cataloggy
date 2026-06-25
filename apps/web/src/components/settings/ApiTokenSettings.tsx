import { FormEvent, useEffect, useRef, useState } from "react";
import { runtimeConfig } from "../../api";
import { Eye, EyeOff, Check } from "lucide-react";

export function ApiTokenSettings() {
  const [token, setToken] = useState(runtimeConfig.getToken());
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  const save = (e: FormEvent) => {
    e.preventDefault();
    runtimeConfig.setToken(token);
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        The API token authenticates requests to your Cataloggy server. It is stored in localStorage.
      </p>
      <div className="relative">
        <input
          type={showToken ? "text" : "password"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste your API token"
          className="w-full rounded-xl border px-4 py-3 pr-20 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-0)", color: "var(--text)" }}
        />
        <button
          type="button"
          onClick={() => setShowToken((p) => !p)}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--text-dim)]"
          style={{ color: "var(--text-mute)" }}
          aria-label={showToken ? "Hide token" : "Show token"}
        >
          {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <p className="text-xs text-amber-600">Only use this on trusted devices.</p>
      <button
        type="submit"
        className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
          saved
            ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20"
            : "bg-claw-500 text-white hover:bg-claw-600 shadow-lg shadow-claw-500/20"
        }`}
      >
        {saved ? <><Check size={16} /> Saved</> : "Save token"}
      </button>
    </form>
  );
}
