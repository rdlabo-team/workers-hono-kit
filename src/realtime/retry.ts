/** Durable Object error flags documented by the Workers runtime. */
export interface DurableObjectErrorLike {
  retryable?: boolean;
  overloaded?: boolean;
}

/** Retry policy for an idempotent Durable Object operation. */
export interface DurableObjectRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  wait?: (delayMs: number) => Promise<void>;
}

function hasFlag(error: unknown, flag: keyof DurableObjectErrorLike): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return (error as Record<string, unknown>)[flag] === true;
}

function defaultWait(delayMs: number): Promise<void> {
  const runtimeScheduler = (globalThis as { scheduler?: { wait?: (ms: number) => Promise<void> } }).scheduler;
  return runtimeScheduler?.wait
    ? runtimeScheduler.wait(delayMs)
    : new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Return whether a Durable Object failure may be retried safely by policy. */
export function isRetryableDurableObjectError(error: unknown): boolean {
  return hasFlag(error, 'retryable') && !hasFlag(error, 'overloaded');
}

/**
 * Retry an idempotent Durable Object operation with jittered exponential backoff.
 *
 * `operation` is invoked again for every attempt. Callers must create a fresh stub inside it,
 * because a stub that threw may remain in a broken state. Overload errors are never retried.
 */
export async function retryDurableObjectOperation<T>(
  operation: (attempt: number) => Promise<T>,
  options: DurableObjectRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 100);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 1000);
  const random = options.random ?? Math.random;
  const wait = options.wait ?? defaultWait;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error: unknown) {
      if (!isRetryableDurableObjectError(error) || attempt + 1 >= maxAttempts) {
        throw error;
      }
      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt * random());
      await wait(delayMs);
    }
  }

  throw new Error('Durable Object retry exhausted');
}
