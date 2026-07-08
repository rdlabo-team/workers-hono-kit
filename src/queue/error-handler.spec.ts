import { describe, expect, it, vi } from 'vitest';
import type { QueueMessageLike } from './consumer.js';
import { createQueueErrorHandler } from './error-handler.js';

function fakeMessage(overrides: Partial<QueueMessageLike> = {}): QueueMessageLike {
  return {
    id: 'msg-1',
    attempts: 1,
    body: { userId: 1 },
    ack: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

describe('createQueueErrorHandler', () => {
  it('logs every failure and captures with queue context', () => {
    const captureException = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = createQueueErrorHandler({
      queue: 'payment-reload',
      captureException,
    });
    const error = new Error('boom');
    const message = fakeMessage({ id: 'fail-1', attempts: 2 });

    onError(error, message);

    expect(errorSpy).toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { queue: 'payment-reload', queue_message_id: 'fail-1' },
      extra: { attempts: 2, body: { userId: 1 } },
    });
    errorSpy.mockRestore();
  });

  it('skips capture until after maxRetries (foodlabel noise gate)', () => {
    const captureException = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = createQueueErrorHandler({
      queue: 'payment-reload',
      maxRetries: 3,
      captureException,
    });

    onError(new Error('retry'), fakeMessage({ attempts: 3 }));
    expect(captureException).not.toHaveBeenCalled();

    onError(new Error('final'), fakeMessage({ attempts: 4 }));
    expect(captureException).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it('wires sentry when provided', () => {
    const captureException = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = createQueueErrorHandler({
      queue: 'payment-reload',
      sentry: { captureException },
    });

    onError(new Error('boom'), fakeMessage());

    expect(captureException).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it('captureException takes precedence over sentry', () => {
    const captureException = vi.fn();
    const sentryCapture = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = createQueueErrorHandler({
      queue: 'payment-reload',
      sentry: { captureException: sentryCapture },
      captureException,
    });

    onError(new Error('boom'), fakeMessage());

    expect(captureException).toHaveBeenCalledOnce();
    expect(sentryCapture).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('console-only when captureException is omitted', () => {
    const captureException = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = createQueueErrorHandler({ queue: 'movies' });

    onError(new Error('boom'), fakeMessage());

    expect(errorSpy).toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
