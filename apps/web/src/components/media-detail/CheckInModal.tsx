import { useState } from "react";
import { Radio, X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { useExitAnimation } from "../../hooks/useExitAnimation";
import { SECTION_TITLE } from "../typography";

export function CheckInModal({
  seriesName,
  defaultSeason,
  defaultEpisode,
  onCheckIn,
  onClose,
}: {
  seriesName: string;
  defaultSeason: number;
  defaultEpisode: number;
  onCheckIn: (season: number, episode: number) => Promise<void>;
  onClose: () => void;
}) {
  const [season, setSeason] = useState(String(defaultSeason));
  const [episode, setEpisode] = useState(String(defaultEpisode));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const { exiting, requestClose, onExitAnimationEnd } = useExitAnimation(onClose);

  useScrollLock();
  useEscapeKey(requestClose);

  const submit = async () => {
    const s = parseInt(season, 10);
    const ep = parseInt(episode, 10);
    if (!s || !ep || s < 1 || ep < 1) { setError("Enter valid season and episode numbers"); return; }
    setSaving(true);
    setError(null);
    try {
      await onCheckIn(s, ep);
      requestClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check in");
      setSaving(false);
    }
  };

  return (
    <div className={`overlay-scrim overlay-fade fixed inset-0 z-[60] flex items-center justify-center p-4 ${exiting ? "overlay-exit" : ""}`} onClick={requestClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkin-modal-title"
        tabIndex={-1}
        className={`overlay-dialog w-full max-w-sm rounded-2xl border shadow-md ${exiting ? "overlay-exit" : ""}`}
        style={{ borderColor: "var(--border)", background: "var(--bg-0)" }}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onExitAnimationEnd}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-claw-text" />
            <h3 id="checkin-modal-title" className={SECTION_TITLE} style={{ color: "var(--text)" }}>Check In</h3>
          </div>
          <button onClick={requestClose} aria-label="Close" className="rounded-lg p-1.5 hover:bg-[var(--surface-strong)]" style={{ color: "var(--text-mute)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>Which episode of <span className="font-semibold" style={{ color: "var(--text)" }}>{seriesName}</span> are you watching?</p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="checkin-season" className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-mute)" }}>Season</label>
              <input
                id="checkin-season"
                type="number" min="1" value={season}
                onChange={(e) => setSeason(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
                style={{ borderColor: "var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}
              />
            </div>
            <div className="flex-1">
              <label htmlFor="checkin-episode" className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-mute)" }}>Episode</label>
              <input
                id="checkin-episode"
                type="number" min="1" value={episode}
                onChange={(e) => setEpisode(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
                style={{ borderColor: "var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}
              />
            </div>
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              type="button" onClick={requestClose}
              className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-strong)]"
              style={{ background: "var(--surface)", color: "var(--text-dim)" }}
            >
              Cancel
            </button>
            <button
              type="button" disabled={saving} onClick={() => void submit()}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-claw-500 px-4 py-2.5 text-sm font-semibold text-claw-on hover:bg-claw-600 disabled:opacity-50 transition-colors"
            >
              <Radio className="h-3.5 w-3.5" />
              {saving ? "Checking in…" : "Check In"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
