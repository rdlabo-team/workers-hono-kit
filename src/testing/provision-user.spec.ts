import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionUser } from './auth';
import { FakeFirebaseVerifier } from './fakes';

// provisionUser は DB INSERT を伴う kit 機能なので、kit 側で（最小の users テーブルに対して）検証する。
// ローカル MySQL(root/root@127.0.0.1:3306) が無い環境では skip（CI でDBが無くても落とさない）。

const DB = 'hono_kit_provision_test';
let pool: Pool | undefined;
let ready = false;

beforeAll(async () => {
  try {
    const root = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root' });
    await root.query(`DROP DATABASE IF EXISTS \`${DB}\``);
    await root.query(`CREATE DATABASE \`${DB}\``);
    await root.end();
    pool = mysql.createPool({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root', database: DB });
    await pool.query(
      'CREATE TABLE users (id BIGINT AUTO_INCREMENT PRIMARY KEY, firebase_uid VARCHAR(255) UNIQUE, agree INT)',
    );
    ready = true;
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  if (pool) {
    await pool.end();
  }
});

describe('provisionUser (DB-backed)', () => {
  it('トークン登録 + users 行 INSERT を行い、その userId を返す', async () => {
    if (!ready || !pool) {
      return;
    }
    const fb = new FakeFirebaseVerifier();
    const r = await provisionUser(pool, fb, { uid: 'u1' });
    expect(r.userId).toBeGreaterThan(0);
    expect(r.token).toBe('tok-u1');
    expect(await fb.verifyIdToken('tok-u1')).toMatchObject({ uid: 'u1' });
    const [rows] = await pool.query('SELECT firebase_uid, agree FROM users WHERE id = ?', [r.userId]);
    expect((rows as { firebase_uid: string; agree: number }[])[0]).toMatchObject({ firebase_uid: 'u1', agree: 1 });
  });

  it('同 uid は既存行を再利用する（冪等・重複 INSERT しない）', async () => {
    if (!ready || !pool) {
      return;
    }
    const fb = new FakeFirebaseVerifier();
    const a = await provisionUser(pool, fb, { uid: 'dup' });
    const b = await provisionUser(pool, fb, { uid: 'dup' });
    expect(b.userId).toBe(a.userId);
    const [rows] = await pool.query('SELECT COUNT(*) c FROM users WHERE firebase_uid = ?', ['dup']);
    expect((rows as { c: number }[])[0].c).toBe(1);
  });

  it('agree とカスタム token を上書きできる', async () => {
    if (!ready || !pool) {
      return;
    }
    const fb = new FakeFirebaseVerifier();
    const r = await provisionUser(pool, fb, { uid: 'u-agree', token: 'custom', agree: -1 });
    expect(r.token).toBe('custom');
    const [rows] = await pool.query('SELECT agree FROM users WHERE id = ?', [r.userId]);
    expect((rows as { agree: number }[])[0].agree).toBe(-1);
  });
});
