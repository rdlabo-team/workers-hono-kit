/**
 * JST wire conversion and DATE-column normalization for MySQL / Drizzle.
 *
 * @remarks
 * Business-time semantics are consolidated in {@link ../business-time/index.js | business-time}. This
 * module only owns the MySQL connection default, the DATE column's `toDriver`, and the column
 * `customType` params.
 */

import { normalizeBusinessDate } from '../business-time/index.js';
import type { BusinessDate } from '../business-time/index.js';

/** Default mysql2 connection `timezone` (for the existing JST DB deployment). */
export const MYSQL_TIMEZONE = '+09:00';

/**
 * Normalize a client input to `YYYY-MM-DD` (a JST business calendar date) for a MySQL `DATE` column.
 * Accepts ISO 8601 / `YYYY-MM-DD` / empty strings. A `YYYY-MM-DD` value is passed through without
 * constructing a `Date`.
 *
 * @param value - the string or nullish input to normalize.
 * @returns the business date as `YYYY-MM-DD`, or `null` when the input cannot be resolved.
 */
export function toJstDate(value: string | null | undefined): BusinessDate | null {
  return normalizeBusinessDate(value ?? null);
}

/**
 * Build the params for a `customType` backing a MySQL `timestamp` column with `Date` pass-through.
 *
 * @param fsp - optional fractional-seconds precision; when provided, emits `timestamp(fsp)`.
 */
export const jstTimestampParams = (fsp?: number): { dataType: () => string } => ({
  dataType: () => (fsp != null ? `timestamp(${fsp})` : 'timestamp'),
});

/**
 * Build the params for a `customType` backing a MySQL `datetime` column with `Date` pass-through.
 *
 * @param fsp - optional fractional-seconds precision; when provided, emits `datetime(fsp)`.
 */
export const jstDatetimeParams = (fsp?: number): { dataType: () => string } => ({
  dataType: () => (fsp != null ? `datetime(${fsp})` : 'datetime'),
});

/**
 * Build the params for a `customType` backing a MySQL `date` column with JST normalization.
 *
 * @returns params with `toDriver` running {@link toJstDate}.
 */
export const jstDateParams = (): {
  dataType: () => string;
  toDriver: (value: string | null) => string | null;
} => ({
  dataType: () => 'date',
  toDriver: (value: string | null) => toJstDate(value),
});
