import { describe, expect, it, vi } from 'vitest';
import { findMysqlDriverError, logMysqlDriverError } from './mysql-driver-error.js';

describe('findMysqlDriverError', () => {
  const driverError = (errno: number, sqlMessage: string) => ({ errno, sqlMessage, sqlState: 'XXXXX', code: 'ERR' });

  it('mysql2 形エラーを直接検出する', () => {
    const err = driverError(1064, 'syntax error');
    expect(findMysqlDriverError(err)).toBe(err);
  });

  it('Drizzle wrap（cause）を辿る', () => {
    const cause = driverError(1062, 'Duplicate entry');
    const wrapped = { message: 'Failed query', cause };
    expect(findMysqlDriverError(wrapped)).toBe(cause);
  });

  it('非 DB エラーは null', () => {
    expect(findMysqlDriverError(new Error('plain'))).toBeNull();
  });

  it('循環参照の cause チェーンでも無限ループしない', () => {
    const a: Record<string, unknown> = { message: 'a' };
    const b: Record<string, unknown> = { message: 'b', cause: a };
    a.cause = b;
    expect(findMysqlDriverError(a)).toBeNull();
  });

  it('循環参照の途中に mysql2 エラーがあれば検出する', () => {
    const driver = driverError(1062, 'Duplicate entry');
    const wrapper: Record<string, unknown> = { message: 'wrap', cause: driver };
    (driver as Record<string, unknown>).cause = wrapper;
    expect(findMysqlDriverError(wrapper)).toBe(driver);
  });

  it('null / undefined を渡しても null を返す', () => {
    expect(findMysqlDriverError(null)).toBeNull();
    expect(findMysqlDriverError(undefined)).toBeNull();
  });

  it('深い cause チェーンでも検出する', () => {
    const driver = driverError(1045, 'Access denied');
    const err = { message: 'L1', cause: { message: 'L2', cause: { message: 'L3', cause: driver } } };
    expect(findMysqlDriverError(err)).toBe(driver);
  });
});

describe('logMysqlDriverError', () => {
  it('500 は console.error で sqlMessage と errno を出す', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = { errno: 1064, sqlMessage: 'SQL syntax', sql: 'SELECT bad', code: 'ERR' };
    logMysqlDriverError(err, 500);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toContain('QueryFailedError (500)');
    expect(errorSpy.mock.calls[0][1]).toEqual({ errno: 1064, sql: 'SELECT bad', code: 'ERR' });
    errorSpy.mockRestore();
  });

  it('400 は console.warn で出す', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logMysqlDriverError({ errno: 1062, sqlMessage: 'Duplicate entry' }, 400);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it('非 DB エラーでも fallback メッセージでログする', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logMysqlDriverError(new Error('generic failure'), 500);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toContain('QueryFailedError (500): generic failure');
    expect(errorSpy.mock.calls[0][1]).toBeUndefined();
    errorSpy.mockRestore();
  });

  it('非 Error の thrown value でも String 化してログする', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logMysqlDriverError('raw string thrown', 400);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('raw string thrown');
    warnSpy.mockRestore();
  });
});
