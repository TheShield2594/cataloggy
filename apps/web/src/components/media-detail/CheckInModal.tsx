import { useEffect, useState } from "react";
import { Radio, X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = async () => {
    const s = parseInt(season, 10);
    const ep = parseInt(episode, 10);
    if (!s || !ep || s < 1 || ep < 1) { setError("Enter valid season and episode numbers"); return; }
    setSaving(true);
    setError(null);
    try {
      await onCheckIn(s, ep);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check in");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkin-modal-title"
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl border border-ink-100 bg-cream-50 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-claw-600" />
            <h3 id="checkin-modal-title" className="text-base font-bold text-ink-900">Check In</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-ink-600">Which episode of <span className="font-semibold text-ink-900">{seriesName}</span> are you watching?</p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="checkin-season" className="mb-1.5 block text-xs font-medium text-ink-500">Season</label>
              <input
                id="checkin-season"
                type="number" min="1" value={season}
                onChange={(e) => setSeason(e.target.value)}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="checkin-episode" className="mb-1.5 block text-xs font-medium text-ink-500">Episode</label>
              <input
                id="checkin-episode"
                type="number" min="1" value={episode}
                onChange={(e) => setEpisode(e.target.value)}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
              />
            </div>
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              type="button" onClick={onClose}
              className="flex-1 rounded-xl bg-ink-100 px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button" disabled={saving} onClick={() => void submit()}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-claw-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-claw-600 disabled:opacity-50 transition-colors"
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
