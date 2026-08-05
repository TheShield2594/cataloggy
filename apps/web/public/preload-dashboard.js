// Starts the dashboard's opening requests during HTML parse, before the app
// bundle has finished downloading.
//
// Without this, the first byte of data cannot be asked for until the entry chunk
// has arrived and been parsed, React has mounted, and the dashboard's effect has
// run. On a phone that ordering costs several hundred milliseconds in which the
// connection is idle. This runs the moment the parser reaches it — the request
// is already in flight while the bundle is still downloading.
//
// Everything here is best-effort. A missing token, an unusual deployment, a
// rejected fetch: all of them fall through silently and the app fetches normally.
// It must never throw, and it must never be the reason a page fails to start.
(function () {
  "use strict";

  try {
    // Only the landing route. Any other entry point renders a different page,
    // and these responses would be fetched for nothing.
    if (window.location.pathname !== "/") return;

    var base = (
      (window.localStorage.getItem("cataloggy_api_base_override") || "").trim() ||
      window.__CATALOGGY_API_BASE__ ||
      ""
    ).replace(/\/+$/, "");
    if (!base) return;

    var token = window.localStorage.getItem("cataloggy_token");
    var profileId = window.localStorage.getItem("cataloggy_profile_id");
    // No token means the setup wizard, no profile means the profile picker —
    // neither of which shows any of this.
    if (!token || !profileId) return;

    var headers = {
      Authorization: "Bearer " + token,
      "x-profile-id": profileId,
    };
    var profileToken = window.localStorage.getItem("cataloggy_profile_token");
    if (profileToken) headers["x-profile-token"] = profileToken;

    // These must stay character-for-character what api.ts requests, since that
    // is how it recognises them. A mismatch is not a breakage — the response
    // goes unclaimed and the app fetches again — but it is a wasted request.
    var paths = ["/series/progress", "/watch/history?limit=20&offset=0", "/watch/stats"];

    var preloaded = {};
    for (var i = 0; i < paths.length; i++) {
      (function (path) {
        preloaded[path] = fetch(base + path, { headers: headers }).catch(function () {
          // Claimed and discarded by api.ts, which then fetches normally.
          return null;
        });
      })(paths[i]);
    }

    window.__CATALOGGY_PRELOAD__ = preloaded;
  } catch (error) {
    // Private-mode localStorage, a blocked fetch, anything at all — startup
    // matters more than this optimisation.
  }
})();
