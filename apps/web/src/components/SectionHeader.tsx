import type { ReactNode } from "react";
import { SECTION_TITLE } from "./typography";

/**
 * A section's title, how many things are in it, and whatever control belongs on
 * the same line — scroll arrows, a "see all" link.
 *
 * Lived inside `DashboardPage.tsx` and was exported from it so the test file
 * could reach it, which is the tell that it was never a page's own component.
 */
export function SectionHeader({
  title,
  count,
  children,
}: {
  title: string;
  /** Shown as a pill beside the title. Omitted, or zero, draws nothing. */
  count?: number | undefined;
  children?: ReactNode | undefined;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className={SECTION_TITLE} style={{ color: "var(--text)" }}>
          {title}
        </h2>
        {count !== undefined && count > 0 && (
          <span
            className="meta rounded-full px-2.5 py-1"
            style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}
          >
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
