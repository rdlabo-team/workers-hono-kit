import { HTTPException } from 'hono/http-exception';

/** Scalar values that may identify an idempotency scope. */
export type IdempotencyScopeValue = string | number;

/** A stable business scope for an idempotency key, such as user and tenant ids. */
export type IdempotencyScope = Readonly<Record<string, IdempotencyScopeValue>>;

/** Validated input persisted by an idempotency store. */
export interface IdempotencyInput<TScope extends IdempotencyScope = IdempotencyScope> {
  /** Caller-supplied idempotency key. */
  key: string;
  /** SHA-256 of the canonical request payload. */
  payloadHash: string;
  /** Application-defined isolation scope. */
  scope: TScope;
}

/** Options used to validate an idempotency key and hash its payload. */
export interface CreateIdempotencyInputOptions<TScope extends IdempotencyScope> {
  /** Header value. `undefined` disables idempotency for backward compatibility. */
  key: string | undefined;
  /** Request payload whose semantic identity must remain stable across retries. */
  payload: unknown;
  /** Application-defined isolation scope. */
  scope: TScope;
  /** Maximum accepted key length. Defaults to 255. */
  maxKeyLength?: number;
}

/** Raised when an idempotency key is empty or exceeds the configured limit. */
export class IdempotencyKeyValidationError extends Error {
  constructor(message = 'Invalid Idempotency-Key') {
    super(message);
    this.name = 'IdempotencyKeyValidationError';
  }
}

/** Raised when a payload contains a value that cannot be represented by JSON. */
export class IdempotencyPayloadValidationError extends Error {
  constructor(message = 'Idempotency payload must contain only JSON values') {
    super(message);
    this.name = 'IdempotencyPayloadValidationError';
  }
}

/** Raised when a key is reused with a different canonical payload. */
export class IdempotencyConflictError extends Error {
  constructor(message = 'Idempotency-Key was already used with a different payload') {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

/** Raised when another request currently owns the same idempotency key. */
export class IdempotencyInFlightError extends Error {
  constructor(message = 'Idempotent request is still processing') {
    super(message);
    this.name = 'IdempotencyInFlightError';
  }
}

/** Result returned by the store reservation step. */
export type IdempotencyReservation<TResponse> = { kind: 'acquired' } | { kind: 'replay'; response: TResponse };

/** Transaction-bound persistence operations required by {@link runIdempotentMutation}. */
export interface IdempotentMutationStore<TScope extends IdempotencyScope, TResponse> {
  /** Atomically reserve a key or return its previously completed response. */
  reserve(input: IdempotencyInput<TScope>): Promise<IdempotencyReservation<TResponse>>;
  /** Persist the mutation response in the same transaction as the domain write. */
  complete(input: IdempotencyInput<TScope>, response: TResponse): Promise<void>;
}

/** Deterministically serialize JSON data with locale-independent, UTF-16 code-unit key ordering. */
export function canonicalJson(value: unknown): string {
  try {
    return canonicalJsonValue(value, new Set<object>());
  } catch (error) {
    if (error instanceof IdempotencyPayloadValidationError) {
      throw error;
    }
    throw new IdempotencyPayloadValidationError();
  }
}

function canonicalJsonValue(value: unknown, ancestors: Set<object>): string {
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    const expectedKeys = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
    if (
      keys.length !== expectedKeys.size ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
    ) {
      throw new IdempotencyPayloadValidationError();
    }
    const items = Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new IdempotencyPayloadValidationError();
      }
      return descriptor.value as unknown;
    });
    if (ancestors.has(value)) {
      throw new IdempotencyPayloadValidationError();
    }
    ancestors.add(value);
    const serialized = `[${items.map((item) => canonicalJsonValue(item, ancestors)).join(',')}]`;
    ancestors.delete(value);
    return serialized;
  }
  if (value !== null && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new IdempotencyPayloadValidationError();
    }
    if (ancestors.has(value)) {
      throw new IdempotencyPayloadValidationError();
    }
    const entries = Reflect.ownKeys(value).map((key): [string, unknown] => {
      if (typeof key !== 'string') {
        throw new IdempotencyPayloadValidationError();
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new IdempotencyPayloadValidationError();
      }
      return [key, descriptor.value as unknown];
    });
    ancestors.add(value);
    const serialized = `{${entries
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJsonValue(item, ancestors)}`)
      .join(',')}}`;
    ancestors.delete(value);
    return serialized;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new IdempotencyPayloadValidationError();
  }
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new IdempotencyPayloadValidationError();
  }
  return serialized;
}

/** Hash a value after canonical JSON serialization using the Workers Web Crypto API. */
export async function sha256CanonicalJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Validate an optional idempotency key and build its persistence input. */
export async function createIdempotencyInput<TScope extends IdempotencyScope>(
  options: CreateIdempotencyInputOptions<TScope>,
): Promise<IdempotencyInput<TScope> | undefined> {
  if (options.key === undefined) {
    return undefined;
  }
  const maxKeyLength = options.maxKeyLength ?? 255;
  if (options.key.length === 0 || options.key.length > maxKeyLength) {
    throw new IdempotencyKeyValidationError();
  }
  return {
    key: options.key,
    payloadHash: await sha256CanonicalJson(options.payload),
    scope: options.scope,
  };
}

/**
 * Execute a mutation with store-provided reservation and completion steps.
 *
 * @remarks
 * The caller must bind `store` and `mutate` to the same database transaction. This function owns
 * the state machine; the consuming application owns its schema and ORM adapter.
 */
export async function runIdempotentMutation<TScope extends IdempotencyScope, TResponse>(options: {
  /** Optional input; omitted keys preserve legacy non-idempotent behavior. */
  input: IdempotencyInput<TScope> | undefined;
  /** Transaction-bound persistence adapter. */
  store: IdempotentMutationStore<TScope, TResponse>;
  /** Domain mutation executed only after this request acquires the key. */
  mutate: () => Promise<TResponse>;
}): Promise<TResponse> {
  if (!options.input) {
    return options.mutate();
  }
  const reservation = await options.store.reserve(options.input);
  if (reservation.kind === 'replay') {
    return reservation.response;
  }
  const response = await options.mutate();
  await options.store.complete(options.input, response);
  return response;
}

/** Map standard idempotency failures to Hono HTTP exceptions without hiding unrelated errors. */
export async function withIdempotencyHttpErrors<T>(run: () => Promise<T>): Promise<T> {
  return run().catch((error: unknown) => {
    if (error instanceof IdempotencyKeyValidationError || error instanceof IdempotencyPayloadValidationError) {
      throw new HTTPException(400, { message: error.message });
    }
    if (error instanceof IdempotencyConflictError) {
      throw new HTTPException(409, { message: error.message });
    }
    if (error instanceof IdempotencyInFlightError) {
      throw new HTTPException(503, { message: error.message });
    }
    throw error;
  });
}
