import { describe, expect, it, vi } from 'vitest';
import { isRetryableDurableObjectError, retryDurableObjectOperation } from './retry.js';

describe('retryDurableObjectOperation', () => {
  it('re-invokes the operation with backoff for retryable failures', async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('reset'), { retryable: true }))
      .mockResolvedValue('ok');
    const wait = vi.fn(() => Promise.resolve());

    await expect(retryDurableObjectOperation(operation, { random: () => 0.5, baseDelayMs: 100, wait })).resolves.toBe(
      'ok',
    );
    expect(operation).toHaveBeenNthCalledWith(1, 0);
    expect(operation).toHaveBeenNthCalledWith(2, 1);
    expect(wait).toHaveBeenCalledWith(50);
  });

  it('does not retry overloaded or non-retryable failures', async () => {
    const overloaded = Object.assign(new Error('busy'), { retryable: true, overloaded: true });
    const operation = vi.fn().mockRejectedValue(overloaded);
    await expect(retryDurableObjectOperation(operation)).rejects.toBe(overloaded);
    expect(operation).toHaveBeenCalledOnce();
    expect(isRetryableDurableObjectError(overloaded)).toBe(false);
  });

  it('stops after the configured attempt count', async () => {
    const error = Object.assign(new Error('reset'), { retryable: true });
    const operation = vi.fn().mockRejectedValue(error);
    await expect(
      retryDurableObjectOperation(operation, { maxAttempts: 3, wait: () => Promise.resolve() }),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
