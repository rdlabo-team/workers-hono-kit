#!/usr/bin/env node
// Record the Drizzle baseline (0000) as *already applied* on an existing (brownfield) MySQL DB,
// without executing its CREATE TABLE statements. One-time per environment.
//
// なぜ: 現行サービスの DB は先にスキーマが在るため、introspect 由来の baseline 0000 を `db:migrate`
// で流すと衝突する。代わりに `__drizzle_migrations` に marker を 1 行入れ、以後 `db:migrate` が when の
// 大きい 0001+ だけを適用するようにする（新規/テスト DB は marker 無しでフルチェーン＝挙動不変）。
//
// 実行基盤: VPC 内（AWS CodeBuild 等）から RDS へ直 TCP。Hyperdrive は Workers 専用で使えない。
// creds は env（CodeBuild では Secrets Manager → env に注入）:
//   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
// migrations フォルダ: 既定 ./drizzle（--migrations <dir> または MIGRATIONS_DIR で上書き）。
//
// usage:
//   npx workers-hono-kit-db-baseline [--migrations ./drizzle]
import { createConnection } from 'mysql2/promise';
import { baselineMigrations } from '../dist/db/migrate.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const migrationsFolder = arg('migrations') ?? process.env.MIGRATIONS_DIR ?? './drizzle';
const conn = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? '3306'),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? 'root',
  database: process.env.DB_NAME,
};

if (!conn.database) {
  console.error('[db:baseline] DB_NAME is required.');
  process.exit(1);
}

console.log(`[db:baseline] target = ${conn.user}@${conn.host}:${conn.port}/${conn.database} (migrations: ${migrationsFolder})`);

const db = await createConnection(conn);
try {
  const res = await baselineMigrations({ db, migrationsFolder });
  if (res.status === 'already-baselined') {
    console.log(`[db:baseline] already baselined (${res.tag}, created_at=${res.when}). no-op.`);
  } else {
    console.log(
      `[db:baseline] inserted baseline marker for ${res.tag} (created_at=${res.when}). ` +
        `0000 is now recorded as applied; future migrations will run.`,
    );
  }
} catch (err) {
  console.error('[db:baseline] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.end();
}
