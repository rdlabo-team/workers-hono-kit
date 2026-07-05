/**
 * Brownfield baseline for Drizzle MySQL migrations.
 *
 * An existing (in-production) DB already has its schema, so running the committed baseline migration
 * (`drizzle/0000_*.sql` = the CREATE TABLE statements introspected from the current schema) via
 * `db:migrate` fails as every table collides. Instead, 0000 is **recorded as "applied" without being
 * executed**.
 *
 * How "applied" is decided (drizzle-orm/mysql-core dialect.migrate): it determines the pending set from
 * **only the maximum `created_at`** in `__drizzle_migrations(id, hash, created_at)`, running just the
 * migrations where `max(created_at) < entry.when`. The hash is stored but not used for the decision. So
 * inserting one row as the 0000 marker — `(hash, created_at = that entry's when)` — makes subsequent
 * `db:migrate` runs apply only the later 0001+ (larger `when`) and skip 0000. A fresh / test DB has no
 * marker, so the full chain runs (behavior unchanged).
 *
 * This function does not depend on `drizzle-orm` (it reads the journal/SQL itself and hashes with the
 * same sha256 as drizzle). It runs raw SQL against a QueryRunner (a mysql2 `Connection`/`Pool` is
 * structurally assignable).
 *
 * @packageDocumentation
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { QueryRunner } from './database.js';

/** The default migration-tracking table name used by drizzle. */
const MIGRATIONS_TABLE = '__drizzle_migrations';

/** A single `meta/_journal.json` entry (only the fields we need). */
interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** Identifying info for the baseline (i.e. first) migration. */
export interface BaselineEntry {
  /** The migration tag (e.g. `0000_melted_weapon_omega`). */
  tag: string;
  /** The `when` from `_journal.json` (= drizzle's `created_at` / `folderMillis`). */
  when: number;
  /** The sha256 of the raw `<tag>.sql` contents (the same algorithm as drizzle). */
  hash: string;
}

/**
 * Read the baseline (first) entry from `migrationsFolder` (drizzle's `out`, e.g. `./drizzle`).
 *
 * @param migrationsFolder - the folder containing `meta/_journal.json` and `<tag>.sql`.
 * @returns the baseline entry (tag/when/hash).
 * @throws Error when the journal is missing, the entries are empty, or `<tag>.sql` is missing.
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
  // The origin is always the first entry (0000). Later 0001+ are "new changes" that should run even on
  // an existing DB.
  const first = entries[0];
  const sqlPath = join(migrationsFolder, `${first.tag}.sql`);
  if (!existsSync(sqlPath)) {
    throw new Error(`Can't find ${first.tag}.sql under ${migrationsFolder}.`);
  }
  const sql = readFileSync(sqlPath, 'utf8');
  return { tag: first.tag, when: first.when, hash: createHash('sha256').update(sql).digest('hex') };
}

/** Options for {@link baselineMigrations}. */
export interface BaselineMigrationsOptions {
  /** A QueryRunner for raw SQL (a mysql2 `Connection`/`Pool` is assignable). Must already be connected to the target DB. */
  db: QueryRunner;
  /** Drizzle's `out` folder (defaults to `./drizzle`). */
  migrationsFolder?: string;
}

/** The result of {@link baselineMigrations}. */
export type BaselineResult =
  | { status: 'inserted'; tag: string; when: number; hash: string }
  | { status: 'already-baselined'; tag: string; when: number };

async function rowsOf(db: QueryRunner, sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
  const result = (await db.query(sql, params)) as [Record<string, unknown>[] | undefined, unknown];
  return result[0] ?? [];
}

/**
 * Record the baseline (0000) as "applied" on an existing DB. Idempotent, with safety guards.
 *
 * @remarks
 * Guards:
 * - If a baseline marker (`created_at = when`) already exists → **no-op** (`already-baselined`).
 * - If there is no marker but `__drizzle_migrations` has other rows → **abort** (unexpected state).
 * - If the target DB has no base tables (an empty DB) → **abort** (skipping 0000 on an empty DB would
 *   never create the tables; use `db:migrate` for a fresh DB).
 *
 * @param options - the connection and migrations folder; see {@link BaselineMigrationsOptions}.
 * @returns whether a marker was inserted or the DB was already baselined.
 * @throws Error when one of the guards above trips.
 */
export async function baselineMigrations(options: BaselineMigrationsOptions): Promise<BaselineResult> {
  const { db, migrationsFolder = './drizzle' } = options;
  const baseline = readBaselineEntry(migrationsFolder);

  // Same DDL as the migrator (a no-op if it already exists).
  await db.query(
    `create table if not exists \`${MIGRATIONS_TABLE}\` (
      id serial primary key,
      hash text not null,
      created_at bigint
    )`,
  );

  // If a baseline marker already exists, this is an idempotent no-op.
  const existing = await rowsOf(db, `select id from \`${MIGRATIONS_TABLE}\` where created_at = ? limit 1`, [
    baseline.when,
  ]);
  if (existing.length > 0) {
    return { status: 'already-baselined', tag: baseline.tag, when: baseline.when };
  }

  // No marker but rows exist = already in some other state. Abort to avoid misfiring.
  const countRows = await rowsOf(db, `select count(*) as n from \`${MIGRATIONS_TABLE}\``);
  const rowCount = Number(countRows[0]?.n ?? 0);
  if (rowCount > 0) {
    throw new Error(
      `${MIGRATIONS_TABLE} already has ${rowCount} row(s) but no baseline marker (created_at=${baseline.when}). ` +
        `Migration state is unexpected — refusing to insert. Inspect \`${MIGRATIONS_TABLE}\` manually.`,
    );
  }

  // Baselining an empty DB is dangerous (treating 0000 as skipped would never create the tables).
  // Confirm this is a brownfield DB.
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
