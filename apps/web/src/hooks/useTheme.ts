import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "glass" | "midnight" | "letterboxd";

export const THEMES: { id: Theme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "glass", label: "Glass" },
  { id: "midnight", label: "Midnight Cinema" },
  { id: "letterboxd", label: "Letterboxd" },
];

const STORAGE_KEY = "cataloggy:theme";

// The colour the browser paints its own chrome with — the address bar on
// Android, the status bar in an installed app. It has to be each theme's
// --bg-0 exactly: a near-match reads as a seam between the app and the phone.
const THEME_BG: Record<Theme, string> = {
  light: "#f2f2f7",
  dark: "#000000",
  glass: "#0b0d12",
  midnight: "#07080d",
  letterboxd: "#14181c",
};

function isTheme(value: string | null): value is Theme {
  return THEMES.some((t) => t.id === value);
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isTheme(stored)) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_BG[theme]);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);

  return { theme, setTheme };
}
