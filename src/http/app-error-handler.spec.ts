import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { describe, expect, it, vi } from 'vitest';
import { createAppErrorHandler } from './app-error-handler.js';

describe('createAppErrorHandler', () => {
  const driverError = (errno: number, sqlMessage: string) => ({ errno, sqlMessage, sqlState: 'XXXXX', code: 'ERR' });

  it('uses generic mysql classifier by default', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = new Hono();
    app.use('*', requestId());
    app.get('/db', () => {
      throw Object.assign(new Error('Failed query'), { cause: driverError(1064, 'syntax') });
    });
    app.onError(createAppErrorHandler());

    const res = await app.request('/db');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ statusCode: 500, message: 'Internal server error' });
    vi.restoreAllMocks();
  });

  it('wires sentry when provided', async () => {
    const captureException = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = new Hono();
    app.use('*', requestId());
    app.get('/plain', () => {
      throw new Error('boom');
    });
    app.onError(createAppErrorHandler({ sentry: { captureException } }));

    const res = await app.request('/plain');
    expect(res.status).toBe(500);
    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ tags: { request_id: expect.any(String) } }),
    );
    vi.restoreAllMocks();
  });

  it('getReportError takes precedence over sentry', async () => {
    const reportError = vi.fn();
    const captureException = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = new Hono<{ Variables: { reportError: typeof reportError } }>();
    app.use('*', requestId());
    app.use('*', async (c, next) => {
      c.set('reportError', reportError);
      await next();
    });
    app.get('/plain', () => {
      throw new Error('boom');
    });
    app.onError(
      createAppErrorHandler({
        sentry: { captureException },
        getReportError: (c) => c.get('reportError'),
      }),
    );

    const res = await app.request('/plain');
    expect(res.status).toBe(500);
    expect(reportError).toHaveBeenCalledOnce();
    expect(captureException).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
