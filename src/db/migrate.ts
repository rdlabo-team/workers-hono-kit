/**
 * Brownfield baseline for Drizzle MySQL migrations.
 *
 * 既存（現行サービス）の DB は先にスキーマが存在するため、コミット済みの baseline マイグレーション
 * （`drizzle/0000_*.sql` = 現行スキーマを introspect した CREATE TABLE 群）を `db:migrate` で流すと
 * 全テーブルが衝突して失敗する。そこで 0000 を **実行せず「適用済み」として記録**する。
 *
 * 適用判定の根拠（drizzle-orm/mysql-core dialect.migrate）: `__drizzle_migrations(id, hash,
 * created_at)` の **`created_at` 最大値のみ**で未適用判定し、`max(created_at) < entry.when` の
 * migration だけ実行する。hash は保存されるが判定には使われない。よって 0000 の marker として
 * `(hash, created_at=当該 when)` を 1 行入れれば、以後 `db:migrate` は when がより大きい 0001+ だけを
 * 適用し、0000 は skip する。新規/テスト DB は marker が無いのでフルチェーンが走る（挙動不変）。
 *
 * この関数は `drizzle-orm` に依存しない（journal/SQL を自前で読み、hash は drizzle と同じ sha256）。
 * QueryRunner（mysql2 の `Connection`/`Pool` が構造的に代入可能）に対して生 SQL を実行する。
 *
 * @packageDocumentation
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { QueryRunner } from './database.js';

/** drizzle が使う既定のマイグレーション管理テーブル名。 */
const MIGRATIONS_TABLE = '__drizzle_migrations';

/** `meta/_journal.json` の 1 エントリ（必要なフィールドのみ）。 */
interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** baseline（=最初の）マイグレーションの識別情報。 */
export interface BaselineEntry {
  /** マイグレーション tag（例 `0000_melted_weapon_omega`）。 */
  tag: string;
  /** `_journal.json` の `when`（= drizzle の `created_at`／`folderMillis`）。 */
  when: number;
  /** `<tag>.sql` の生内容の sha256（drizzle と同一アルゴリズム）。 */
  hash: string;
}

/**
 * `migrationsFolder`（drizzle の `out`、例 `./drizzle`）から baseline（最初の）エントリを読む。
 *
 * @param migrationsFolder - `meta/_journal.json` と `<tag>.sql` を含むフォルダ。
 * @returns baseline エントリ（tag/when/hash）。
 * @throws journal が無い / エントリが空 / `<tag>.sql` が無い場合。
 */
export function readBaselineEntry(migrationsFolder: string): BaselineEntry {
  const journalPath = join(migrationsFolder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    throw new Error(`Can't find meta/_journal.json under ${migrationsFolder}. Run \`drizzle-kit generate\` first.`);
  }
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: JournalEntry[] };
  const entries = journal.entries ?? [];
  if (entries.length === 0) {
    throw new Error(`No migration entries in ${journalPath}.`);
  }
  // 起点は必ず最初のエントリ（0000）。以降 0001+ は「新しい変更」なので既存 DB でも実行されるべき。
  const first = entries[0];
  const sqlPath = join(migrationsFolder, `${first.tag}.sql`);
  if (!existsSync(sqlPath)) {
    throw new Error(`Can't find ${first.tag}.sql under ${migrationsFolder}.`);
  }
  const sql = readFileSync(sqlPath, 'utf8');
  return { tag: first.tag, when: first.when, hash: createHash('sha256').update(sql).digest('hex') };
}

/** {@link baselineMigrations} のオプション。 */
export interface BaselineMigrationsOptions {
  /** 生 SQL を実行する QueryRunner（mysql2 `Connection`/`Pool` が代入可能）。対象 DB に接続済みのこと。 */
  db: QueryRunner;
  /** drizzle の `out` フォルダ（既定 `./drizzle`）。 */
  migrationsFolder?: string;
}

/** {@link baselineMigrations} の結果。 */
export type BaselineResult =
  | { status: 'inserted'; tag: string; when: number; hash: string }
  | { status: 'already-baselined'; tag: string; when: number };

async function rowsOf(db: QueryRunner, sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
  const result = (await db.query(sql, params)) as [Record<string, unknown>[] | undefined, unknown];
  return result[0] ?? [];
}

/**
 * 既存 DB へ baseline（0000）を「適用済み」として記録する。冪等・安全ガード付き。
 *
 * @remarks
 * ガード:
 * - 既に baseline marker（`created_at = when`）が在れば **no-op**（`already-baselined`）。
 * - marker は無いが `__drizzle_migrations` に別の行が在る → **中断**（想定外の状態）。
 * - 対象 DB に base table が 1 つも無い（空 DB）→ **中断**（空 DB は 0000 を skip すると
 *   テーブルが作られない。新規 DB には `db:migrate` を使う）。
 *
 * @param options - 接続と migrations フォルダ。{@link BaselineMigrationsOptions} 参照。
 * @returns 挿入したか既に baseline 済みか。
 * @throws 上記ガードに該当する場合。
 */
export async function baselineMigrations(options: BaselineMigrationsOptions): Promise<BaselineResult> {
  const { db, migrationsFolder = './drizzle' } = options;
  const baseline = readBaselineEntry(migrationsFolder);

  // migrator と同一 DDL（存在すれば no-op）。
  await db.query(
    `create table if not exists \`${MIGRATIONS_TABLE}\` (
      id serial primary key,
      hash text not null,
      created_at bigint
    )`,
  );

  // 既に baseline marker があれば冪等 no-op。
  const existing = await rowsOf(db, `select id from \`${MIGRATIONS_TABLE}\` where created_at = ? limit 1`, [
    baseline.when,
  ]);
  if (existing.length > 0) {
    return { status: 'already-baselined', tag: baseline.tag, when: baseline.when };
  }

  // marker は無いが行が在る＝既に別の状態。誤爆防止で中断。
  const countRows = await rowsOf(db, `select count(*) as n from \`${MIGRATIONS_TABLE}\``);
  const rowCount = Number(countRows[0]?.n ?? 0);
  if (rowCount > 0) {
    throw new Error(
      `${MIGRATIONS_TABLE} already has ${rowCount} row(s) but no baseline marker (created_at=${baseline.when}). ` +
        `Migration state is unexpected — refusing to insert. Inspect \`${MIGRATIONS_TABLE}\` manually.`,
    );
  }

  // 空 DB への baseline は危険（0000 を skip 扱いにするとテーブルが作られない）。brownfield 確認。
  const tableRows = await rowsOf(
    db,
    `select count(*) as n from information_schema.tables
      where table_schema = DATABASE() and table_type = 'BASE TABLE' and table_name <> ?`,
    [MIGRATIONS_TABLE],
  );
  const baseTableCount = Number(tableRows[0]?.n ?? 0);
  if (baseTableCount === 0) {
    throw new Error(
      `Target DB has no base tables. baseline records 0000 as applied WITHOUT creating tables — this is only ` +
        `for existing (brownfield) DBs. For a fresh/empty DB run \`drizzle-kit migrate\` instead.`,
    );
  }

  await db.query(`insert into \`${MIGRATIONS_TABLE}\` (\`hash\`, \`created_at\`) values (?, ?)`, [
    baseline.hash,
    baseline.when,
  ]);
  return { status: 'inserted', tag: baseline.tag, when: baseline.when, hash: baseline.hash };
}
