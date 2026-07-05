/**
 * Shared Drizzle column helpers. Removes the need for a thin `custom-types.ts` / `columns.ts` wrapper
 * in each repo.
 *
 * @remarks
 * `drizzle-orm` is a **peer** (the consumer resolves a single copy); the kit does not bundle it. The
 * return types are the `customType` inference as-is (`MySqlCustomColumnBuilder<…>`) with no `any`, so
 * the column's semantic type (`string | Date`, `number | null`, etc.) propagates to the consumer
 * table's `$inferSelect`.
 *
 * **Precondition (a single drizzle copy)**: Drizzle's `SQL` is a **nominal** type carrying a private
 * field `shouldInlineParams`, so if the kit and the consumer resolve different copies of drizzle,
 * `jstTimestamp(…).default(sql\`…\`)` fails with `TS2345: separate declarations of a private property
 * 'shouldInlineParams'`. The fleet references the kit via a `file:` link, which tends to nest a second
 * copy of drizzle under the kit. Pin `drizzle-orm` to the consumer's **own single copy** with tsconfig
 * `paths` (see the "Drizzle column helpers" section of the README). The published package (a single
 * copy) is already unified.
 *
 * **DEFAULT / ON UPDATE CURRENT_TIMESTAMP** is a server-side default (an INSERT / UPDATE that omits the
 * column). The connection's `timezone:'+09:00'` ({@link hyperdriveConnectionOptions}) only applies when
 * the **app binds a `Date`**. Do not conflate the two (see the `datetime-wire` / `drizzle-smoke` JST
 * tests).
 */
import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/mysql-core';
import { decimalNumberParams } from './decimal.js';
import type { DecimalNumberConfig } from './decimal.js';
import { jstDateParams, jstDatetimeParams, jstTimestampParams } from './jst.js';

/**
 * SQL expression for `ON UPDATE CURRENT_TIMESTAMP` (the MySQL session clock).
 * customType columns have no `.onUpdateNow()`, so pair this with `.$onUpdateFn(() => jstOnUpdateNow(fsp))`.
 *
 * @param fsp - optional fractional-seconds precision; when provided, emits `CURRENT_TIMESTAMP(fsp)`.
 */
export const jstOnUpdateNow = (fsp?: number) =>
  fsp != null ? sql`(CURRENT_TIMESTAMP(${sql.raw(String(fsp))}))` : sql`(CURRENT_TIMESTAMP)`;

/** MySQL `timestamp` — pass-through. A `Date` is formatted as JST by mysql2 via the connection `timezone:'+09:00'`. */
export const jstTimestamp = (name: string, opts?: { fsp?: number }) =>
  customType<{ data: string | Date; driverData: string | Date }>(jstTimestampParams(opts?.fsp))(name);

/** MySQL `datetime` — same pass-through policy as {@link jstTimestamp}. */
export const jstDatetime = (name: string, opts?: { fsp?: number }) =>
  customType<{ data: string | Date; driverData: string | Date }>(jstDatetimeParams(opts?.fsp))(name);

/** MySQL `date` — on INSERT/UPDATE, normalizes ISO / empty strings to `YYYY-MM-DD` (via `toDriver`). */
export const jstDate = (name: string) =>
  customType<{ data: string | null; driverData: string | null }>(jstDateParams())(name);

/** MySQL `decimal` — SELECT coerces string→number via `fromDriver`; writes bind the number as-is. */
export const decimalNumber = (name: string, config: DecimalNumberConfig) =>
  customType<{ data: number | null; driverData: number | string | null }>(decimalNumberParams(config))(name);
