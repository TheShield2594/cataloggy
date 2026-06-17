const htmlEscapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (str: string): string =>
  str.replace(/[&<>"']/g, (ch) => htmlEscapeMap[ch]);

export const renderOAuthHtml = (detail: string, title = "Trakt Connection Failed"): string =>
  `<html><body style="background:#0f172a;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
  <div style="text-align:center"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><p style="color:#94a3b8;margin-top:1rem">You can close this tab and return to Cataloggy.</p></div>
</body></html>`;
