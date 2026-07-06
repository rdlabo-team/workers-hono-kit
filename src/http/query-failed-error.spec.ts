import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { describe, expect, it, vi } from 'vitest';
import type { ClassifiedDbError } from './query-failed-error.js';
import { createQueryFailedNestErrorHandler, reportClassifiedDbError } from './query-failed-error.js';

describe('reportClassifiedDbError', () => {
  it('500 は reportError を呼ぶ', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reportError = vi.fn();
    const err = { errno: 1064, sqlMessage: 'syntax error', sqlState: '42000' };
    reportClassifiedDbError(err, { statusCode: 500, message: 'db error' }, reportError, 'req-1');
    expect(reportError).toHaveBeenCalledWith(err, { requestId: 'req-1' });
    vi.restoreAllMocks();
  });

  it('400 は reportError を呼ばない', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reportError = vi.fn();
    const err = { errno: 1062, sqlMessage: 'Duplicate entry', sqlState: '23000' };
    reportClassifiedDbError(err, { statusCode: 400, message: 'dup' }, reportError, 'req-1');
    expect(reportError).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('createQueryFailedNestErrorHandler', () => {
  const driverError = (errno: number, sqlMessage: string) => ({ errno, sqlMessage, sqlState: 'XXXXX', code: 'ERR' });

  const classify = (err: unknown): ClassifiedDbError | null => {
    const e = err as { cause?: unknown };
    const driver = (e.cause ?? err) as { errno?: number; sqlMessage?: string };
    if (typeof driver.errno !== 'number') {
      return null;
    }
    if (driver.errno === 1062) {
      return { statusCode: 400, message: 'duplicate' };
    }
    return { statusCode: 500, message: 'db error' };
  };

  function buildApp(onUnhandledError = vi.fn()) {
    const app = new Hono();
    app.use('*', requestId());
    app.get('/db-500', () => {
      throw Object.assign(new Error('Failed query'), { cause: driverError(1064, 'syntax') });
    });
    app.get('/db-400', () => {
      throw Object.assign(new Error('Failed query'), { cause: driverError(1062, 'Duplicate') });
    });
    app.get('/plain', () => {
      throw new Error('boom');
    });
    app.onError(createQueryFailedNestErrorHandler({ classify, onUnhandledError }));
    return { app, onUnhandledError };
  }

  it('500 DB エラーは onUnhandledError し parity body を返す', async () => {
    const onUnhandledError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = buildApp(onUnhandledError);

    const res = await app.request('/db-500');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ statusCode: 500, message: 'db error' });
    expect(onUnhandledError).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('400 DB エラーは onUnhandledError しない', async () => {
    const onUnhandledError = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { app } = buildApp(onUnhandledError);

    const res = await app.request('/db-400');

    expect(res.status).toBe(400);
    expect(onUnhandledError).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('非 DB エラーは nestErrorHandler に委譲する', async () => {
    const onUnhandledError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = buildApp(onUnhandledError);

    const res = await app.request('/plain');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(onUnhandledError).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
