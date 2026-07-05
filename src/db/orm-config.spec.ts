import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { honoDrizzleConfig } from './orm-config.js';

// process.env を汚さないよう、DB_SECRET/DB_* を各テスト後に元へ戻す。
const SAVED = { ...process.env };
afterEach(() => {
  process.env = { ...SAVED };
});
beforeEach(() => {
  delete process.env.DB_SECRET;
  delete process.env.DB_HOST;
  delete process.env.DB_PORT;
  delete process.env.DB_USER;
  delete process.env.DB_PASSWORD;
});

const validSecret = JSON.stringify({
  host: 'master.rds.example.com',
  port: 3306,
  dbname: 'foodlabel',
  username: 'admin',
  password: 'p@ss:w/ord',
  engine: 'mysql',
});

describe('honoDrizzleConfig', () => {
  it('DB_SECRET 未設定なら env→デフォルト（127.0.0.1/root）にフォールバック', () => {
    const cfg = honoDrizzleConfig({ database: 'foodlabel' });
    expect(cfg.dbCredentials).toEqual({
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: 'root',
      database: 'foodlabel',
    });
  });

  it('DB_SECRET があれば全接続情報をそれで確定（dbname が database を上書き）', () => {
    process.env.DB_SECRET = validSecret;
    const cfg = honoDrizzleConfig({ database: 'ignored' });
    expect(cfg.dbCredentials).toEqual({
      host: 'master.rds.example.com',
      port: 3306,
      user: 'admin',
      password: 'p@ss:w/ord',
      database: 'foodlabel',
    });
  });

  it('DB_SECRET の port 欠損時は 3306 を補う', () => {
    process.env.DB_SECRET = JSON.stringify({ host: 'h', dbname: 'd', username: 'u', password: 'p' });
    expect(honoDrizzleConfig({ database: 'x' }).dbCredentials.port).toBe(3306);
  });

  it('DB_SECRET が不正 JSON なら throw（静かにフォールバックしない）', () => {
    process.env.DB_SECRET = '{not json';
    expect(() => honoDrizzleConfig({ database: 'x' })).toThrow(/not valid JSON/);
  });

  it('DB_SECRET に必須キー欠損があれば throw', () => {
    process.env.DB_SECRET = JSON.stringify({ host: 'h', dbname: 'd', username: 'u' }); // password 欠損
    expect(() => honoDrizzleConfig({ database: 'x' })).toThrow(/host, dbname, username, password/);
  });

  it('casing/schema/out などの標準値は不変', () => {
    const cfg = honoDrizzleConfig({ database: 'x' });
    expect(cfg).toMatchObject({ dialect: 'mysql', casing: 'snake_case', schema: './src/db/schemes', out: './drizzle' });
  });
});
