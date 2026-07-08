import { describe, expect, it, vi } from 'vitest';
import { createWaitUntilDefer, defaultDefer } from './defer.js';

describe('defaultDefer', () => {
  it('does not throw on resolved promises', () => {
    expect(() => {
      defaultDefer(Promise.resolve('ok'));
    }).not.toThrow();
  });

  it('swallows rejections', async () => {
    const rejected = Promise.reject(new Error('boom'));
    rejected.catch(() => undefined);
    expect(() => {
      defaultDefer(rejected);
    }).not.toThrow();
  });
});

describe('createWaitUntilDefer', () => {
  it('registers promise via ctx.waitUntil', () => {
    const waitUntil = vi.fn();
    const defer = createWaitUntilDefer({ waitUntil });
    defer(Promise.resolve());
    expect(waitUntil).toHaveBeenCalledOnce();
  });
});
