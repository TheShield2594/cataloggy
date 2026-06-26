(function () {
  try {
    // Keep in sync with THEMES in apps/web/src/hooks/useTheme.ts
    var knownThemes = ["light", "dark", "glass", "midnight", "letterboxd"];
    var stored = localStorage.getItem("cataloggy:theme");
    var theme = knownThemes.indexOf(stored) !== -1 ? stored : "light";
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
    var bg = theme === "light" ? "#faf6ef" : "#15161a";
    document.documentElement.style.backgroundColor = bg;
  } catch (e) {}
})();
