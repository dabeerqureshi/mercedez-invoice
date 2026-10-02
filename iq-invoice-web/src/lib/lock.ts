/**
 * Serialised async lock.
 *
 * Browserbase allows only ONE session per Context at a time (the site can force
 * a logout otherwise) and the free plan allows one session at a time anyway, so
 * every browser operation (price lookup / connect / verify / disconnect) runs
 * through this in-process queue. On serverless this serialises per instance;
 * the DB-level `pending_login` gate additionally blocks lookups while a manual
 * login is in progress, which is where the cross-instance risk lives.
 */
let chain: Promise<unknown> = Promise.resolve();

export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(
    () => fn(),
    () => fn(),
  );
  // Keep the chain alive regardless of the outcome of this task.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
