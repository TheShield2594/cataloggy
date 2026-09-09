/**
 * The verdicts the "test this target" endpoints — `POST /ai/test` and
 * `POST /notifications/channels/:id/test` — are allowed to return.
 *
 * Both features deliberately permit private and loopback targets, because
 * reaching a self-hosted Ollama or a LAN ntfy is the whole point of them (see
 * `ssrf.ts`). Neither echoes the target's response body. What they *did* echo
 * was the outcome in full detail: `HTTP 401` versus `HTTP 404` names the
 * service behind a port, and undici's `connect ECONNREFUSED 10.0.0.5:22`
 * versus a timeout separates a closed port from a filtered one. An API_TOKEN
 * holder — an XSS'd browser tab, say, which cannot otherwise reach the LAN —
 * could walk the home network one test request at a time and read the answers.
 *
 * So the caller gets the verdict and nothing else. The detail still exists;
 * it goes to the server log, where the operator — who is the person the detail
 * was for — can read it.
 */
export type OutboundFailure =
  /** The URL is not a target this install will send to (policy, or it does not resolve). */
  | "blocked"
  /** Something about the stored or submitted configuration, not the target. */
  | "misconfigured"
  /** No usable connection: refused, filtered, timed out, DNS gone, redirected away. */
  | "unreachable"
  /** Reached, and it did not accept the request or did not answer usefully. */
  | "rejected"
  /** Anything else that went wrong on our side. */
  | "failed";

export const OUTBOUND_FAILURE_MESSAGE: Record<OutboundFailure, string> = {
  blocked: "That address is not one Cataloggy will send to.",
  misconfigured: "The configuration is incomplete or invalid.",
  unreachable: "Could not reach that address — check the host and port. The server log has the details.",
  rejected: "Reached it, but it did not accept the request — check the path and token. The server log has the details.",
  failed: "The test could not be completed. The server log has the details.",
};

export type OutboundTestResult = {
  success: false;
  outcome: OutboundFailure;
  error: string;
};

/**
 * The body both test endpoints answer a failure with. `message` overrides the
 * stock wording for the cases where a more specific one is still safe — one
 * that describes our own configuration rather than what the target did.
 */
export const outboundFailure = (
  outcome: OutboundFailure,
  message: string = OUTBOUND_FAILURE_MESSAGE[outcome]
): OutboundTestResult => ({ success: false, outcome, error: message });
