import { Check, X } from "lucide-react";
import type { CheckIn } from "../../api";
import { KICKER, PAGE_TITLE } from "../typography";
import { HERO_SCRIM } from "./ContinueWatchingHero";

/** The active check-in, featured at the top of the dashboard. */
export function NowWatchingHero({
  checkin,
  onCheckout,
}: {
  checkin: CheckIn;
  /** `true` logs the watch on the way out; `false` just ends the check-in. */
  onCheckout: (logWatch: boolean) => void;
}) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl"
      style={{
        minHeight: "13rem",
        border: "1px solid var(--border)",
        // No backdrop, no hero treatment — see HERO_SCRIM.
        ...(checkin.background ? null : { background: "var(--bg-1)" }),
      }}
    >
      {checkin.background && (
        <>
          <img
            src={checkin.background}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-70 scale-110"
          />
          <div className="absolute inset-0" style={{ background: HERO_SCRIM }} />
        </>
      )}
      <div className="relative z-10 flex h-full flex-col gap-5 p-6 sm:flex-row sm:items-center">
        {checkin.poster && (
          <div className="h-32 w-[5.5rem] flex-none overflow-hidden rounded-xl" style={{ boxShadow: "0 0 0 1px var(--border), var(--elevation-2)" }}>
            <img src={checkin.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-claw-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-claw-500" />
            </span>
            <span className={`${KICKER} text-claw-text`}>Now Watching</span>
          </div>
          {/* A heading, not a styled paragraph. This is visually the largest
              thing on the dashboard and it was invisible to heading
              navigation — the one element a screen-reader user jumping by
              heading would most expect to land on was the one they couldn't
              reach. */}
          <h2 className={`mt-1 truncate ${PAGE_TITLE}`} style={{ color: "var(--text)" }}>{checkin.name}</h2>
          {checkin.season != null && checkin.episode != null && (
            <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
              S{String(checkin.season).padStart(2, "0")}:E{String(checkin.episode).padStart(2, "0")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-none">
          <button
            type="button"
            onClick={() => onCheckout(true)}
            className="btn-primary"
          >
            <Check className="h-4 w-4" /> Finished
          </button>
          <button
            type="button"
            onClick={() => onCheckout(false)}
            className="btn-secondary h-10 w-10 p-0"
            aria-label="Check out without logging"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
