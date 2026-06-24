import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createConnection, createPool } from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

/**
 * フリート共通のテスト DB ヘルパ（各 repo の testing/db.ts を集約）。
 * テストスキーマは「コミット済み Drizzle マイグレーション」を単一ソースとして構築する
 * （手書き schema.sql ではなく `db:generate` 由来の ./drizzle）。
 *
 * Node 専用（vitest 下で実行）。実行時 parity には無関係なテスト基盤。
 */
export interface TestDbConnection {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface CreateTestDbOptions {
  /** テスト DB 名（例 'tipsys_test'）。並列実行で feature 毎に分けたい場合は呼び出し側で TEST_DB を解決して渡す。 */
  dbName: string;
  /** Drizzle マイグレーションフォルダの絶対パス（呼び出し側で `join(here, '..', 'drizzle')` を解決して渡す）。 */
  migrationsFolder: string;
  /** 接続情報。未指定は env（DB_HOST/DB_PORT/DB_USER/DB_PASSWORD）→ 127.0.0.1/3306/root/root。 */
  connection?: Partial<TestDbConnection>;
}

export interface TestDb {
  readonly dbName: string;
  readonly connection: TestDbConnection;
  /** DROP/CREATE して Drizzle マイグレーションを適用しスキーマを構築。 */
  resetSchema(): Promise<void>;
  /** テスト DB に繋いだ mysql2 プールを返す（afterAll で pool.end()）。 */
  createTestPool(): Pool;
  /** 全テーブルを TRUNCATE（information_schema から動的取得。__drizzle_migrations は除外）。 */
  truncateAll(pool: Pool): Promise<void>;
  /** 1 行 insert する汎用 seed（列名→値）。route spec の fixture 用。 */
  seed(pool: Pool, table: string, row: Record<string, unknown>): Promise<void>;
  /** ローカル MySQL が到達可能か（`describe.skipIf(!(await mysqlReachable()))` のガード用）。 */
  mysqlReachable(): Promise<boolean>;
}

function resolveConnection(override?: Partial<TestDbConnection>): TestDbConnection {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return {
    host: override?.host ?? env.DB_HOST ?? '127.0.0.1',
    port: override?.port ?? Number(env.DB_PORT ?? '3306'),
    user: override?.user ?? env.DB_USER ?? 'root',
    password: override?.password ?? env.DB_PASSWORD ?? 'root',
  };
}

export function createTestDb(options: CreateTestDbOptions): TestDb {
  const { dbName, migrationsFolder } = options;
  const connection = resolveConnection(options.connection);

  return {
    dbName,
    connection,

    async resetSchema(): Promise<void> {
      const admin = await createConnection({ ...connection, multipleStatements: true });
      await admin.query(
        `DROP DATABASE IF EXISTS \`${dbName}\`; CREATE DATABASE \`${dbName}\` DEFAULT CHARACTER SET utf8mb4;`,
      );
      await admin.changeUser({ database: dbName });
      await migrate(drizzle(admin), { migrationsFolder });
      await admin.end();
    },

    createTestPool(): Pool {
      // decimalNumbers / timezone mirror the runtime hyperdriveConnectionOptions so specs read
      // DECIMAL columns as numbers and handle datetime in +09:00 (JST), matching production.
      return createPool({
        ...connection,
        database: dbName,
        connectionLimit: 5,
        decimalNumbers: true,
        timezone: '+09:00',
      });
    },

    async truncateAll(pool: Pool): Promise<void> {
      const [rows] = await pool.query(
        "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type='BASE TABLE' AND table_name <> '__drizzle_migrations'",
        [dbName],
      );
      const tables = (rows as { t: string }[]).map((r) => r.t);
      await pool.query('SET FOREIGN_KEY_CHECKS=0');
      for (const t of tables) {
        await pool.query(`TRUNCATE TABLE \`${t}\``);
      }
      await pool.query('SET FOREIGN_KEY_CHECKS=1');
    },

    async seed(pool: Pool, table: string, row: Record<string, unknown>): Promise<void> {
      const cols = Object.keys(row);
      if (cols.length === 0) {
        return;
      }
      const placeholders = cols.map(() => '?').join(', ');
      const columnList = cols.map((c) => `\`${c}\``).join(', ');
      await pool.query(`INSERT INTO \`${table}\` (${columnList}) VALUES (${placeholders})`, Object.values(row));
    },

    async mysqlReachable(): Promise<boolean> {
      try {
        const c = await createConnection({ ...connection });
        await c.end();
        return true;
      } catch {
        return false;
      }
    },
  };
}
