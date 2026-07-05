import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QueryRunner } from './database.js';
import { baselineMigrations, readBaselineEntry } from './migrate.js';

// kit の DB 系 spec は「ローカル MySQL 不要」の方針に従い、QueryRunner をフェイクして SQL 応答を
// スクリプトする。fs は baseline フォルダ fixture（temp dir）で本物を使う。

const WHEN = 1781921343070;
const TAG = '0000_test_baseline';
const SQL = 'CREATE TABLE `users` (`id` int);';

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'kit-mig-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'mysql', entries: [{ idx: 0, version: '5', when: WHEN, tag: TAG }] }),
  );
  writeFileSync(join(folder, `${TAG}.sql`), SQL);
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** sql の部分一致で応答を返すフェイク QueryRunner。既定は空 rows。 */
function fakeDb(handlers: { match: RegExp; rows: Record<string, unknown>[] }[]) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const h = handlers.find((x) => x.match.test(sql));
    return [h ? h.rows : [], []];
  });
  return { db: { query } as QueryRunner, calls, query };
}

describe('readBaselineEntry', () => {
  it('最初のエントリの tag/when と <tag>.sql の sha256 を返す', () => {
    const entry = readBaselineEntry(folder);
    expect(entry.tag).toBe(TAG);
    expect(entry.when).toBe(WHEN);
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('journal が無ければ throw', () => {
    expect(() => readBaselineEntry(join(folder, 'nope'))).toThrow(/_journal\.json/);
  });
});

describe('baselineMigrations', () => {
  it('空の marker テーブル＋brownfield（table 有）→ marker を INSERT する', async () => {
    const { db, calls } = fakeDb([
      { match: /where created_at = \?/, rows: [] }, // 既存 marker 無し
      { match: /count\(\*\) as n from `__drizzle_migrations`/, rows: [{ n: 0 }] }, // 行なし
      { match: /information_schema\.tables/, rows: [{ n: 5 }] }, // brownfield
    ]);
    const res = await baselineMigrations({ db, migrationsFolder: folder });
    expect(res).toMatchObject({ status: 'inserted', tag: TAG, when: WHEN });

    const insert = calls.find((c) => c.sql.includes('insert into `__drizzle_migrations`'));
    expect(insert).toBeTruthy();
    expect(insert?.params).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/), WHEN]);
  });

  it('既に baseline marker が在れば冪等 no-op（INSERT しない）', async () => {
    const { db, calls } = fakeDb([{ match: /where created_at = \?/, rows: [{ id: 1 }] }]);
    const res = await baselineMigrations({ db, migrationsFolder: folder });
    expect(res).toMatchObject({ status: 'already-baselined', tag: TAG, when: WHEN });
    expect(calls.some((c) => c.sql.includes('insert into'))).toBe(false);
  });

  it('marker 無し・他の行が在る → 中断', async () => {
    const { db } = fakeDb([
      { match: /where created_at = \?/, rows: [] },
      { match: /count\(\*\) as n from `__drizzle_migrations`/, rows: [{ n: 2 }] },
    ]);
    await expect(baselineMigrations({ db, migrationsFolder: folder })).rejects.toThrow(/no baseline marker/);
  });

  it('空 DB（base table 0）→ 中断', async () => {
    const { db } = fakeDb([
      { match: /where created_at = \?/, rows: [] },
      { match: /count\(\*\) as n from `__drizzle_migrations`/, rows: [{ n: 0 }] },
      { match: /information_schema\.tables/, rows: [{ n: 0 }] },
    ]);
    await expect(baselineMigrations({ db, migrationsFolder: folder })).rejects.toThrow(/no base tables/);
  });
});
