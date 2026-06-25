import { useState } from "react";
import { X } from "lucide-react";
import { WatchLogTarget } from "./detailPanelUtils";
import { useFocusTrap } from "../../hooks/useFocusTrap";

export function WatchDateModal({
  target,
  onLog,
  onClose,
}: {
  target: WatchLogTarget;
  onLog: (date: string, episode?: { season: number; episode: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"quick" | "custom">("quick");
  const [customDate, setCustomDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>();

  // For episode mode: let user pick season+episode
  const [season, setSeason] = useState(target.kind === "episode" ? target.season : 1);
  const [episode, setEpisode] = useState(target.kind === "episode" ? target.episode : 1);

  const submit = async (dateIso: string) => {
    setSaving(true);
    setError(null);
    try {
      const episodeInfo = target.kind === "episode" ? { season, episode } : undefined;
      await onLog(dateIso, episodeInfo);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log watch");
      setSaving(false);
    }
  };

  const releaseDate = target.kind === "movie" ? target.releaseDate : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-date-modal-title"
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl border p-6 shadow-md"
        style={{ borderColor: "var(--border)", background: "var(--bg-0)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 id="watch-date-modal-title" className="text-base font-semibold" style={{ color: "var(--text)" }}>When did you watch this?</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:opacity-80" style={{ color: "var(--text-mute)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Episode pickers for series */}
        {target.kind === "episode" && (
          <div className="mb-4 flex gap-3">
            <div className="flex-1">
              <label htmlFor="watch-date-season" className="mb-1 block text-xs" style={{ color: "var(--text-mute)" }}>Season</label>
              <input
                id="watch-date-season"
                type="number"
                min={1}
                value={season}
                onChange={(e) => setSeason(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-claw-500/30"
                style={{ borderColor: "var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}
              />
            </div>
            <div className="flex-1">
              <label htmlFor="watch-date-episode" className="mb-1 block text-xs" style={{ color: "var(--text-mute)" }}>Episode</label>
              <input
                id="watch-date-episode"
                type="number"
                min={1}
                value={episode}
                onChange={(e) => setEpisode(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-claw-500/30"
                style={{ borderColor: "var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}
              />
            </div>
          </div>
        )}

        {mode === "quick" ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit(new Date().toISOString())}
              className="rounded-xl bg-plum-500 px-4 py-3 text-sm font-semibold text-white hover:bg-plum-600 disabled:opacity-50 transition-colors"
            >
              Just finished
            </button>
            {releaseDate && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  const [y, m, d] = releaseDate.split("-").map(Number);
                  void submit(new Date(Date.UTC(y, m - 1, d, 12)).toISOString());
                }}
                className="rounded-xl px-4 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)] disabled:opacity-50"
                style={{ background: "var(--surface)", color: "var(--text)" }}
              >
                Release date
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit(new Date("2000-01-01T12:00:00.000Z").toISOString())}
              className="rounded-xl px-4 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)] disabled:opacity-50"
              style={{ background: "var(--surface)", color: "var(--text)" }}
            >
              Unknown date
            </button>
            <button
              type="button"
              onClick={() => setMode("custom")}
              className="rounded-xl px-4 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)]"
              style={{ background: "var(--surface)", color: "var(--text)" }}
            >
              Other date
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="date"
              value={customDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setCustomDate(e.target.value)}
              className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-claw-500/30"
              style={{ borderColor: "var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("quick")}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-strong)]"
                style={{ background: "var(--surface)", color: "var(--text-dim)" }}
              >
                Back
              </button>
              <button
                type="button"
                disabled={saving || !customDate}
                onClick={() => {
                  const [y, m, d] = customDate.split("-").map(Number);
                  void submit(new Date(Date.UTC(y, m - 1, d, 12)).toISOString());
                }}
                className="flex-1 rounded-xl bg-claw-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-claw-600 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Log Watch"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
      </div>
    </div>
  );
}
