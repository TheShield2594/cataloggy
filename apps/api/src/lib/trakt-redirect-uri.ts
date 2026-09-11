/**
 * The `redirect_uri` sent to Trakt, for all three places that need it: the
 * status route reports it so Settings can show what to register in the Trakt
 * app, the authorize route puts it in the URL the browser is sent to, and the
 * callback route repeats it in the token exchange — where Trakt requires it to
 * match the authorize call byte for byte, or answers `invalid_grant`.
 *
 * It is one function rather than three copies of the same expression for two
 * reasons. The first is that drift between them is silent until a token
 * exchange fails, and the error Trakt returns then says nothing about which of
 * the three disagreed.
 *
 * The second is that "this value cannot be influenced by a caller" is a claim
 * worth being able to check in one place. It is read from the environment and
 * nothing else — no query parameter, header or body reaches it — which is what
 * makes an open-redirect through the OAuth flow impossible here. The `state`
 * check in `trakt-oauth-state.ts` covers the CSRF half of the same flow.
 */
export const traktRedirectUri = (): string =>
  process.env.TRAKT_REDIRECT_URI ??
  `${process.env.CATALOGGY_API_PUBLIC ?? "http://localhost:7000"}/trakt/oauth/callback`;
