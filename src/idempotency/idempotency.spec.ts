import { describe, expect, it, vi } from 'vitest';
import {
  canonicalJson,
  createIdempotencyInput,
  IdempotencyConflictError,
  IdempotencyInFlightError,
  IdempotencyKeyValidationError,
  runIdempotentMutation,
  sha256CanonicalJson,
  withIdempotencyHttpErrors,
} from './idempotency.js';

describe('idempotency standard', () => {
  it('canonicalizes object key order and omits undefined values', async () => {
    const left = { z: [2, { b: true, a: 'x' }], omitted: undefined, a: 1 };
    const right = { a: 1, z: [2, { a: 'x', b: true }] };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    await expect(sha256CanonicalJson(left)).resolves.toBe(await sha256CanonicalJson(right));
  });

  it('keeps missing keys backward compatible and validates supplied keys', async () => {
    await expect(
      createIdempotencyInput({ key: undefined, payload: {}, scope: { userId: 1 } }),
    ).resolves.toBeUndefined();
    await expect(createIdempotencyInput({ key: '', payload: {}, scope: { userId: 1 } })).rejects.toBeInstanceOf(
      IdempotencyKeyValidationError,
    );
    await expect(
      createIdempotencyInput({ key: 'x'.repeat(256), payload: {}, scope: { userId: 1 } }),
    ).rejects.toBeInstanceOf(IdempotencyKeyValidationError);
  });

  it('replays completed responses without executing the mutation', async () => {
    const mutate = vi.fn(async () => ({ id: 99 }));
    const complete = vi.fn(async () => undefined);
    const result = await runIdempotentMutation({
      input: { key: 'create-1', payloadHash: 'hash', scope: { userId: 1, groupId: 2 } },
      store: { reserve: async () => ({ kind: 'replay', response: { id: 7 } }), complete },
      mutate,
    });
    expect(result).toEqual({ id: 7 });
    expect(mutate).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('completes an acquired key after the domain mutation', async () => {
    const calls: string[] = [];
    const input = { key: 'create-1', payloadHash: 'hash', scope: { tenantId: 2 } };
    await expect(
      runIdempotentMutation({
        input,
        store: {
          reserve: async () => {
            calls.push('reserve');
            return { kind: 'acquired' };
          },
          complete: async (completedInput, response) => {
            expect(completedInput).toBe(input);
            expect(response).toEqual({ id: 8 });
            calls.push('complete');
          },
        },
        mutate: async () => {
          calls.push('mutate');
          return { id: 8 };
        },
      }),
    ).resolves.toEqual({ id: 8 });
    expect(calls).toEqual(['reserve', 'mutate', 'complete']);
  });

  it.each([
    [new IdempotencyKeyValidationError(), 400],
    [new IdempotencyConflictError(), 409],
    [new IdempotencyInFlightError(), 503],
  ])('maps %s to HTTP %s', async (error, status) => {
    await expect(withIdempotencyHttpErrors(async () => Promise.reject(error))).rejects.toMatchObject({ status });
  });

  it('does not hide unrelated errors', async () => {
    const error = new Error('database unavailable');
    await expect(withIdempotencyHttpErrors(async () => Promise.reject(error))).rejects.toBe(error);
  });
});
