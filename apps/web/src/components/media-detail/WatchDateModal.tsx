import { useState } from "react";
import { X } from "lucide-react";
import { WatchLogTarget } from "./detailPanelUtils";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { useExitAnimation } from "../../hooks/useExitAnimation";
import { SECTION_TITLE } from "../typography";

export function WatchDateModal({
  target,
  onLog,
  onClose,
}: {
  target: WatchLogTarget;
  onLog: (date: string, episode?: { season: number; episode: number }, dateUnknown?: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"quick" | "custom">("quick");
  const [customDate, setCustomDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const { exiting, requestClose, onExitAnimationEnd } = useExitAnimation(onClose);

  useScrollLock();
  useEscapeKey(requestClose);

  // For episode mode: let user pick season+episode
  const [season, setSeason] = useState(target.kind === "episode" ? target.season : 1);
  const [episode, setEpisode] = useState(target.kind === "episode" ? target.episode : 1);

  const submit = async (dateIso: string, dateUnknown?: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const episodeInfo = target.kind === "episode" ? { season, episode } : undefined;
      await onLog(dateIso, episodeInfo, dateUnknown);
      requestClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log watch");
      setSaving(false);
    }
  };

  const releaseDate = target.kind === "movie" ? target.releaseDate : null;

  return (
    <div
      className={`overlay-scrim overlay-fade fixed inset-0 z-[60] flex items-center justify-center p-4 ${exiting ? "overlay-exit" : ""}`}
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-date-modal-title"
        tabIndex={-1}
        className={`glass-surface overlay-dialog w-full max-w-sm rounded-3xl border p-6 shadow-e3 ${exiting ? "overlay-exit" : ""}`}
        style={{ borderColor: "var(--border)", background: "var(--bg-0)" }}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onExitAnimationEnd}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 id="watch-date-modal-title" className={SECTION_TITLE} style={{ color: "var(--text)" }}>When did you watch this?</h3>
          <button type="button" onClick={requestClose} aria-label="Close" className="rounded-lg p-1 hover:opacity-80" style={{ color: "var(--text-mute)" }}>

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
              className="btn-primary py-3"
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
                className="btn-secondary py-3"
              >
                Release date
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit(new Date().toISOString(), true)}
              title="Logs this watch without a specific date"
              className="btn-secondary flex-col items-start justify-center gap-0.5 py-3 text-left"
            >
              <span className="text-sm font-semibold">Unknown date</span>
              <span className="text-2xs" style={{ color: "var(--text-mute)" }}>Logs without a specific date</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("custom")}
              className="btn-secondary py-3"
            >
              Other date
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="date"
              aria-label="Watch date"
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
                className="btn-secondary flex-1"
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
                className="btn-primary flex-1"
              >
                {saving ? "Saving…" : "Log Watch"}
              </button>
            </div>
          </div>
        )}

        {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
