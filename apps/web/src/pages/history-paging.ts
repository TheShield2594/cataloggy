/**
 * Rows per history request.
 *
 * Its own module rather than a constant on the page, so the route prefetcher can
 * ask for exactly the page the page asks for without importing the page. Read
 * off `HistoryPage`, the warm-up could not send its request until that whole
 * chunk had downloaded and run — which is the wait the prefetch exists to spend
 * in parallel, not to queue behind.
 */
export const PAGE_SIZE = 25;
