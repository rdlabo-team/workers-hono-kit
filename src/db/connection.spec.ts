import { describe, expect, it, vi } from 'vitest';
import { hyperdriveConnectionOptions, withMysqlConnections } from './connection';
import type { HyperdriveLike } from './connection';

const ended: string[] = [];
const opened: Record<string, unknown>[] = [];

vi.mock('mysql2/promise', () => ({
  createConnection: vi.fn(async (opts: Record<string, unknown>) => {
    opened.push(opts);
    const tag = opened.length === 1 ? 'primary' : 'replica';
    return { end: vi.fn(async () => void ended.push(tag)) };
  }),
}));

const hd: HyperdriveLike = { host: 'db.example', user: 'u', password: 'p', database: 'app', port: 3306 };

describe('hyperdriveConnectionOptions', () => {
  it('Hyperdrive から mysql2 オプションを作り disableEval/decimalNumbers を付与する', () => {
    expect(hyperdriveConnectionOptions(hd)).toEqual({
      host: 'db.example',
      user: 'u',
      password: 'p',
      database: 'app',
      port: 3306,
      disableEval: true,
      decimalNumbers: true,
      timezone: '+09:00',
    });
  });

  it('extra で timezone 等を追加できる', () => {
    expect(hyperdriveConnectionOptions(hd, { timezone: '+09:00' })).toMatchObject({
      timezone: '+09:00',
      disableEval: true,
    });
  });
});

describe('withMysqlConnections', () => {
  it('fn の結果を返し、finally で両接続を ctx.waitUntil 越しに閉じる', async () => {
    opened.length = 0;
    ended.length = 0;
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waited.push(p) };

    const result = await withMysqlConnections({ primary: hd, replica: hd }, ctx, async (conns) => {
      expect(conns.primary).toBeDefined();
      expect(conns.replica).toBeDefined();
      return 'done';
    });

    expect(result).toBe('done');
    expect(opened).toHaveLength(2);
    expect(waited).toHaveLength(1);
    await waited[0];
    expect(ended.sort()).toEqual(['primary', 'replica']);
  });
});
