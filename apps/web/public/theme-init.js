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

  var theme = Object.prototype.hasOwnProperty.call(themeBg, stored) ? stored : "light";
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  document.documentElement.style.backgroundColor = themeBg[theme];
})();
