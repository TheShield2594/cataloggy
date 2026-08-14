// A bound on how long something is allowed to take.
//
// Both callers are diagnostics — the readiness probe and `/metrics` — and both
// query the database. A query against an exhausted connection pool is neither
// refused nor served: it waits for a connection that may never come free. So
// the thing that reports the fault has to have a deadline the fault cannot
// exceed, or it hangs in exactly the case it exists to report.
//
// The loser of the race is not cancelled — the queries behind this are single
// statements with nothing downstream of them, and letting one settle unobserved
// is cheaper than the machinery to stop it. What the deadline bounds is the
// *answer*, not the work.
export async function withDeadline<T>(work: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
