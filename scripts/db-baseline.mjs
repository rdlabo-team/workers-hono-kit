#!/usr/bin/env node
// Record the Drizzle baseline (0000) as *already applied* on an existing (brownfield) MySQL DB,
// without executing its CREATE TABLE statements. One-time per environment.
//
// Why: an in-production DB already has its schema, so running the introspect-derived baseline 0000 via
// `db:migrate` collides. Instead we insert a single marker row into `__drizzle_migrations` so that
// subsequent `db:migrate` runs apply only the later 0001+ (larger `when`). A fresh / test DB has no
// marker, so the full chain runs (behavior unchanged).
//
// Where it runs: direct TCP from inside a VPC (e.g. AWS CodeBuild) to RDS. Hyperdrive is Workers-only
// and cannot be used here. Credentials come from env (on CodeBuild, Secrets Manager → injected into env):
//   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
// Migrations folder: defaults to ./drizzle (override with --migrations <dir> or MIGRATIONS_DIR).
//
// usage:
//   npx workers-hono-kit-db-baseline [--migrations ./drizzle]
import { createConnection } from 'mysql2/promise';
import { baselineMigrations } from '../dist/db/migrate.js';
import { resolveDbSecret } from '../dist/db/index.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const migrationsFolder = arg('migrations') ?? process.env.MIGRATIONS_DIR ?? './drizzle';
// Shares the same DB_SECRET handling as db:migrate (honoDrizzleConfig). CI/production passes an AWS
// Secrets Manager RDS managed secret via DB_SECRET (invalid/missing → resolveDbSecret throws). When
// unset, it falls back to the individual DB_* env vars.
const secret = resolveDbSecret();
const conn = secret
  ? {
      host: secret.host,
      port: secret.port,
      user: secret.username,
      password: secret.password,
      database: secret.dbname,
    }
  : {
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? '3306'),
      user: process.env.DB_USER ?? 'root',
      password: process.env.DB_PASSWORD ?? 'root',
      database: process.env.DB_NAME,
    };

if (!conn.database) {
  console.error('[db:baseline] DB_NAME (or DB_SECRET) is required.');
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
