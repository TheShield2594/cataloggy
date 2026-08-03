(function () {
  // Keep in sync with THEMES/THEME_BG in apps/web/src/hooks/useTheme.ts
  var themeBg = {
    light: "#faf6ef",
    dark: "#0d0b0a",
    glass: "#0b0d12",
    midnight: "#07080d",
    letterboxd: "#14181c",
  };

  var stored = null;
  try {
    stored = localStorage.getItem("cataloggy:theme");
  } catch (e) {
    // localStorage unavailable (private browsing, disabled storage, etc.) — fall back to default theme.
  }

  // No stored choice: follow the OS the same way getInitialTheme() in
  // useTheme.ts does. Defaulting to "light" here painted a full-screen cream
  // flash over the loader for dark-mode visitors, then jumped once React mounted.
  var prefersDark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  var theme = Object.prototype.hasOwnProperty.call(themeBg, stored) ? stored : prefersDark ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  document.documentElement.style.backgroundColor = themeBg[theme];

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", themeBg[theme]);
})();
