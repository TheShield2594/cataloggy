import { Theme } from "../hooks/useTheme";

/**
 * Sun/moon slider toggle. All motion is a direct response to the state
 * change (CSS transition), never an idle/looping animation — clouds and
 * star-twinkle keyframes were deliberately dropped to match the app's
 * "fast and purposeful, never decorative" motion rule.
 */
export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={onToggle}
      className="relative h-9 w-16 flex-none rounded-full transition-colors duration-200 active:scale-95"
      style={{
        border: "1px solid var(--border-strong)",
        background: dark ? "#1c2333" : "#bfe3ff",
      }}
    >
      {/* static stars, only visible in dark mode — no twinkle loop */}
      <span
        className="absolute left-2.5 top-2 h-[3px] w-[3px] rounded-full bg-white transition-opacity duration-200"
        style={{ opacity: dark ? 0.9 : 0 }}
      />
      <span
        className="absolute left-4 top-4.5 h-[2px] w-[2px] rounded-full bg-white transition-opacity duration-200"
        style={{ opacity: dark ? 0.7 : 0 }}
      />
      <span
        className="absolute left-2 top-6 h-[2px] w-[2px] rounded-full bg-white transition-opacity duration-200"
        style={{ opacity: dark ? 0.5 : 0 }}
      />

      {/* sliding sun/moon knob */}
      <span
        className="absolute top-1 left-1 flex h-6 w-6 items-center justify-center rounded-full shadow-sm transition-transform duration-200"
        style={{
          transform: dark ? "translateX(28px)" : "translateX(0)",
          background: dark ? "#e2e8f0" : "#fbbf24",
        }}
      >
        {/* moon craters fade in/out with the knob, no separate animation */}
        <span
          className="absolute h-1.5 w-1.5 rounded-full bg-slate-400 transition-opacity duration-200"
          style={{ opacity: dark ? 0.8 : 0, top: "3px", left: "3px" }}
        />
        <span
          className="absolute h-1 w-1 rounded-full bg-slate-400 transition-opacity duration-200"
          style={{ opacity: dark ? 0.6 : 0, bottom: "4px", right: "4px" }}
        />
      </span>
    </button>
  );
}
