export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const queue = items.entries();
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    // One shared iterator is the same hand-out-the-next-index loop as before,
    // and it yields the item alongside its index rather than leaving the lookup
    // to be repeated. `next()` on an array iterator is synchronous, so two
    // workers cannot be handed the same one.
    for (const [i, item] of queue) {
      results[i] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}
