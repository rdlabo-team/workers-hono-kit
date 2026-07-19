import { retryDurableObjectOperation } from './retry.js';
import type { DurableObjectRetryOptions } from './retry.js';

/** Minimal fetch surface implemented by a Durable Object stub. */
export interface DurableObjectFetchStubLike {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

/** A freshly-created request for one Durable Object invocation attempt. */
export interface DurableObjectFetchRequest {
  input: Request | string | URL;
  init?: RequestInit;
}

/** Options for invoking a Durable Object fetch endpoint safely. */
export interface InvokeDurableObjectFetchOptions {
  getStub: () => DurableObjectFetchStubLike;
  createRequest: () => DurableObjectFetchRequest;
  retry?: boolean;
  retryOptions?: DurableObjectRetryOptions;
  errorMessage?: string;
}

/** HTTP response failure returned explicitly by a Durable Object fetch handler. */
export class DurableObjectResponseError extends Error {
  constructor(
    message: string,
    readonly response: Response,
  ) {
    super(message);
    this.name = 'DurableObjectResponseError';
  }
}

/**
 * Invoke a Durable Object fetch endpoint with a fresh stub and request for every attempt.
 *
 * Non-2xx responses always throw. Runtime retryable exceptions are retried only when `retry` is
 * explicitly enabled, allowing callers to keep non-idempotent operations at-most-once.
 */
export async function invokeDurableObjectFetch(options: InvokeDurableObjectFetchOptions): Promise<Response> {
  const invoke = async (): Promise<Response> => {
    const request = options.createRequest();
    const response = await options.getStub().fetch(request.input, request.init);
    if (!response.ok) {
      throw new DurableObjectResponseError(
        `${options.errorMessage ?? 'Durable Object request failed'}: ${response.status}`,
        response,
      );
    }
    return response;
  };

  return options.retry ? retryDurableObjectOperation(invoke, options.retryOptions) : invoke();
}
