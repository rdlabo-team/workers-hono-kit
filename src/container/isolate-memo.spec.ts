import { describe, expect, it, vi } from 'vitest';
import { createIsolateMemo } from './isolate-memo.js';

describe('createIsolateMemo', () => {
  it('reuses a fulfilled promise', async () => {
    const loader = vi.fn(async (n: number) => n * 2);
    const resolve = createIsolateMemo(loader);

    await expect(resolve(3)).resolves.toBe(6);
    await expect(resolve(99)).resolves.toBe(6);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejected promise', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok');
    const resolve = createIsolateMemo(loader);

    await expect(resolve('a')).rejects.toThrow('transient');
    await expect(resolve('b')).resolves.toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('reset clears the cache', async () => {
    const loader = vi.fn(async () => 'v1');
    const resolve = createIsolateMemo(loader);

    await resolve(null);
    resolve.reset();
    loader.mockResolvedValueOnce('v2');
    await expect(resolve(null)).resolves.toBe('v2');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
