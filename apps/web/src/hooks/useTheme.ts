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

function isTheme(value: string | null): value is Theme {
  return THEMES.some((t) => t.id === value);
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isTheme(stored) ? stored : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
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
