import { describe, expect, it, vi } from 'vitest';
import { DurableObjectResponseError, invokeDurableObjectFetch } from './invoke.js';

describe('invokeDurableObjectFetch', () => {
  it('creates a fresh stub and request for retryable idempotent attempts', async () => {
    const retryable = Object.assign(new Error('transient'), { retryable: true });
    const fetches = [
      vi.fn().mockRejectedValue(retryable),
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    ];
    const getStub = vi.fn(() => ({ fetch: fetches.shift()! }));
    const createRequest = vi.fn(() => ({ input: 'https://do/publish', init: { method: 'POST', body: '{}' } }));

    await expect(
      invokeDurableObjectFetch({
        getStub,
        createRequest,
        retry: true,
        retryOptions: { random: () => 0, wait: () => Promise.resolve() },
      }),
    ).resolves.toMatchObject({ status: 204 });
    expect(getStub).toHaveBeenCalledTimes(2);
    expect(createRequest).toHaveBeenCalledTimes(2);
  });

  it('throws an explicit response error for non-2xx responses without retrying them', async () => {
    const getStub = vi.fn(() => ({ fetch: vi.fn().mockResolvedValue(new Response('missing', { status: 404 })) }));

    await expect(
      invokeDurableObjectFetch({
        getStub,
        createRequest: () => ({ input: 'https://do/publish' }),
        retry: true,
        errorMessage: 'Realtime publish failed',
      }),
    ).rejects.toBeInstanceOf(DurableObjectResponseError);
    expect(getStub).toHaveBeenCalledOnce();
  });

  it('does not retry ambiguous failures when retry is disabled', async () => {
    const retryable = Object.assign(new Error('ambiguous'), { retryable: true });
    const fetch = vi.fn().mockRejectedValue(retryable);
    const getStub = vi.fn(() => ({ fetch }));

    await expect(
      invokeDurableObjectFetch({ getStub, createRequest: () => ({ input: 'https://do/emit' }) }),
    ).rejects.toThrow('ambiguous');
    expect(getStub).toHaveBeenCalledOnce();
  });
});
