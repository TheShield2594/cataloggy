import { useEffect } from "react";
import { onQueuedWritesReplayed, replayQueuedWrites } from "../api";
import { useOnline } from "./useOnline";
import { useToast } from "./useToast";

/**
 * Drives the service worker's queue of writes made with no network, and reports
 * what came of them.
 *
 * The worker holds those writes and knows how to send them (see sw.js); what it
 * cannot do is notice the connection coming back on a browser without
 * Background Sync, which is every iPhone. `navigator.onLine` going true is the
 * page's own signal for exactly that, so the page is what pokes it.
 *
 * The report back matters as much as the sending. A watch logged in a basement
 * is a write the user has already been told is saved — if it later reaches the
 * server and the server refuses it, saying nothing turns "saved" into a quiet
 * lie, and the only person who can do anything about it never finds out.
 */
export function useOfflineWriteQueue(): void {
  const online = useOnline();
  const { showToast } = useToast();

  useEffect(() => {
    if (!online) return;
    // On the connection coming back, and on mount: the worker's own fallbacks
    // (a `sync` event, or a replay at worker startup) cover the app being
    // closed, but neither is guaranteed to have run by the time the user is
    // looking at a page built from the rows those writes change.
    void replayQueuedWrites();
  }, [online]);

  useEffect(
    () =>
      onQueuedWritesReplayed(({ replayed, rejected }) => {
        if (replayed) {
          showToast(
            replayed === 1 ? "Sent the change you made offline." : `Sent ${replayed} changes you made offline.`,
            "success"
          );
        }
        if (rejected) {
          showToast(
            rejected === 1
              ? "One change made offline was refused by the server and has been dropped."
              : `${rejected} changes made offline were refused by the server and have been dropped.`,
            "error"
          );
        }
      }),
    [showToast]
  );
}
