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
});
