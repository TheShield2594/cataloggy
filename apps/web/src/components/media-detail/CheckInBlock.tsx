import { Radio } from "lucide-react";
import { CheckIn } from "../../api";

export function CheckInBlock({
  loading,
  activeCheckin,
  isSeries,
  onStartCheckin,
  onStartSeriesCheckin,
  onCheckout,
}: {
  loading: boolean;
  activeCheckin: CheckIn | null;
  isSeries: boolean;
  onStartCheckin: () => void;
  onStartSeriesCheckin: () => void;
  onCheckout: (logWatch: boolean) => void;
}) {
  // Hold the Check In button's footprint (42px = py-2.5 + text-sm line height
  // + borders) instead of rendering nothing — the button materialising a beat
  // after the panel opened shoved every section below it down.
  if (loading) return <div className="skeleton h-[42px] w-full rounded-xl" aria-hidden="true" />;

  if (activeCheckin) {
    return (
      <div className="rounded-xl border border-claw-500/30 bg-claw-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-claw-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-claw-500" />
          </span>
          <span className="text-sm font-semibold text-claw-text">Now Watching</span>
          {activeCheckin.season != null && activeCheckin.episode != null && (
            <span className="text-xs" style={{ color: "var(--text-mute)" }}>S{String(activeCheckin.season).padStart(2, "0")}:E{String(activeCheckin.episode).padStart(2, "0")}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onCheckout(false)}
            className="btn-secondary btn-sm flex-1"
          >
            Check Out
          </button>
          <button
            type="button"
            onClick={() => onCheckout(true)}
            className="btn-primary btn-sm flex-1"
          >
            Finished &amp; Log
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (isSeries) {
          onStartSeriesCheckin();
        } else {
          onStartCheckin();
        }
      }}
      className="btn-secondary w-full"
    >
      <Radio className="h-4 w-4" /> Check In
    </button>
  );
}
