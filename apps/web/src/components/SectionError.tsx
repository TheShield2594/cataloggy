import { AlertCircle } from "lucide-react";
import { SECTION_TITLE } from "./typography";

/**
 * What a failed fetch looks like, with the way out of it.
 *
 * There were three of these. The dashboard's had a Retry button; the ones on
 * Stats and History were hand-rolled red cards with no way back at all, so the
 * only recovery from a dropped request was reloading the browser. Sharing one
 * component is how the retry reaches them.
 */

type Variant = "section" | "page";

export function SectionError({
  message,
  onRetry,
  variant = "section",
}: {
  message: string;
  onRetry: () => void;
  /**
   * `section` is one rail of a page that otherwise loaded — quiet, dashed, no
   * `role="alert"`, because the rest of the screen still works and three failed
   * rails should not announce three times. `page` is the whole screen having
   * failed, which is worth interrupting for.
   */
  variant?: Variant | undefined;
}) {
  const retry = (
    <button
      type="button"
      onClick={onRetry}
      className="text-sm font-medium text-claw-text underline-offset-2 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset rounded"
    >
      Retry
    </button>
  );

  if (variant === "page") {
    return (
      <div
        className="mx-auto max-w-lg rounded-2xl p-8 text-center"
        style={{ border: "1px solid rgba(244,63,94,0.2)", background: "rgba(244,63,94,0.05)" }}
      >
        <AlertCircle className="mx-auto h-12 w-12 text-danger" />
        <p role="alert" className={`mt-3 ${SECTION_TITLE} text-danger`}>
          {message}
        </p>
        <div className="mt-4">{retry}</div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center gap-2 rounded-2xl py-8 text-center"
      style={{ border: "1px dashed var(--border-strong)" }}
    >
      <AlertCircle className="h-7 w-7" style={{ color: "var(--text-mute)" }} />
      <p className="text-sm" style={{ color: "var(--text-dim)" }}>
        {message}
      </p>
      {retry}
    </div>
  );
}
