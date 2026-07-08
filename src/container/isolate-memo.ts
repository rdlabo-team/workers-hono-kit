/**
 * Isolate-scoped async memoization for container bootstrap (secrets, env resolution, etc.).
 *
 * Successful results are reused across requests in the same isolate. Rejected initializations are
 * **not** cached so a transient failure (e.g. Secrets Manager blip) can be retried on the next call.
 *
 * @remarks
 * The memo is not keyed by argument: the loader runs once per isolate using the arguments from the
 * first successful scheduling attempt (same semantics as hand-rolled `let promise` in Workers apps).
 *
 * @packageDocumentation
 */

/** Callable memo with an explicit reset for tests and isolate teardown. */
export interface IsolateMemo<T, TArg> {
  (arg: TArg): Promise<T>;
  reset(): void;
}

/**
 * Create an isolate-scoped memoized async resolver.
 *
 * @param loader - async factory invoked on the first call (and again after a rejection / {@link reset}).
 * @returns a function that returns the cached promise, plus {@link IsolateMemo.reset}.
 * @example
 * ```ts
 * const resolveSecrets = createIsolateMemo(async (env: Env) => {
 *   const secret = await getAuthenticationSecret(awsOpts(env));
 *   return { firebaseSaJson: secret.firebaseProduction };
 * });
 *
 * // first request populates the cache; SM failure is not cached:
 * await resolveSecrets(env).catch(() => undefined);
 * await resolveSecrets(env); // retries SM
 * ```
 */
export function createIsolateMemo<T, TArg>(loader: (arg: TArg) => Promise<T>): IsolateMemo<T, TArg> {
  let cached: Promise<T> | undefined;

  const resolve = (arg: TArg): Promise<T> => {
    if (!cached) {
      cached = loader(arg).catch((error: unknown) => {
        cached = undefined;
        throw error;
      });
    }
    return cached;
  };

  resolve.reset = () => {
    cached = undefined;
  };

  return resolve;
}
