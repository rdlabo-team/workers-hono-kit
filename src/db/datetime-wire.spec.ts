import { int, mysqlTable } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import { createPool } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jstDate, jstTimestamp } from './columns.js';
import { MYSQL_TIMEZONE } from './jst.js';
import { DRIZZLE_ORM_OPTIONS } from './orm-config.js';

const wireRows = mysqlTable('kit_datetime_wire', {
  id: int('id').primaryKey(),
  issuedOn: jstDate('issued_on'),
  createdAt: jstTimestamp('created_at').notNull(),
});

const pool = createPool({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: 'root',
  database: 'mysql',
  connectionLimit: 1,
  timezone: MYSQL_TIMEZONE,
});

let mysqlUp = false;
try {
  await pool.query('SELECT 1');
  mysqlUp = true;
} catch {
  await pool.end();
}

describe.skipIf(!mysqlUp)('JST timestamp wire contract', () => {
  beforeAll(async () => {
    await pool.query(`
      CREATE TEMPORARY TABLE kit_datetime_wire (
        id INT PRIMARY KEY,
        issued_on DATE NULL,
        created_at TIMESTAMP NOT NULL
      )
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('writes a Date instant as a JST wall clock and reads back the same instant', async () => {
    const db = drizzle(pool, { schema: { wireRows }, ...DRIZZLE_ORM_OPTIONS });
    const instant = new Date('2026-01-01T00:00:00.000Z');

    await db.insert(wireRows).values({ id: 1, createdAt: instant });

    const [rows] = await pool.query(
      "SELECT created_at, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS wall_clock FROM kit_datetime_wire",
    );
    const row = (rows as { created_at: Date; wall_clock: string }[])[0];
    expect(row.wall_clock).toBe('2026-01-01 09:00:00');
    expect(row.created_at.getTime()).toBe(instant.getTime());
  });

  it('keeps a calendar date and normalizes an ISO instant to its JST date', async () => {
    const db = drizzle(pool, { schema: { wireRows }, ...DRIZZLE_ORM_OPTIONS });

    await db.insert(wireRows).values([
      { id: 2, issuedOn: '1990-07-05', createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 3, issuedOn: '2026-06-22T20:00:00.000Z', createdAt: new Date('2026-01-01T00:00:00Z') },
    ]);

    const [rows] = await pool.query(
      "SELECT id, DATE_FORMAT(issued_on, '%Y-%m-%d') AS issued_on FROM kit_datetime_wire WHERE id IN (2, 3) ORDER BY id",
    );
    expect(rows).toEqual([
      expect.objectContaining({ id: 2, issued_on: '1990-07-05' }),
      expect.objectContaining({ id: 3, issued_on: '2026-06-23' }),
    ]);
  });
});
