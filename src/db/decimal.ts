/**
 * Drizzle `customType` params for a MySQL `DECIMAL` column.
 *
 * @remarks
 * - **Reads (SELECT)**: `fromDriver` unifies the driver value (`number` / `string` / `null`) to a JS
 *   `number | null`. Combined with the connection's `decimalNumbers: true`
 *   ({@link hyperdriveConnectionOptions} default), it aligns values to numbers even on the Drizzle
 *   builder path when strings like `"0"` / `"100.00"` slip in, without dropping `0`.
 * - **Writes (INSERT/UPDATE)**: `toDriver` binds the number to mysql2 as-is (no `String()` conversion).
 * - Raw-SQL `db.read` relies on the connection's `decimalNumbers: true`; the column's `fromDriver` is
 *   for the Drizzle `select` path.
 */

export interface DecimalNumberConfig {
  precision: number;
  scale: number;
}

/**
 * Normalize a DECIMAL value coming from mysql2 / Drizzle to a JS `number | null`.
 * `0` is preserved as-is so it is not dropped as falsy.
 *
 * @param value - the raw driver value (`number` / `string` / `bigint` / nullish).
 * @returns the coerced finite number, or `null` when it cannot be resolved.
 */
export function coerceDecimalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return null;
}

/**
 * Params for a `customType`. For advanced use; the {@link decimalNumber} column helper is usually enough.
 *
 * @param config - the DECIMAL `precision` / `scale`.
 * @returns the `customType` params (`dataType` / `fromDriver` / `toDriver`).
 */
export const decimalNumberParams = (
  config: DecimalNumberConfig,
): {
  dataType: () => string;
  fromDriver: (value: unknown) => number | null;
  toDriver: (value: number | string | null) => number | string | null;
} => ({
  dataType: () => `decimal(${config.precision},${config.scale})`,
  fromDriver: (value: unknown) => coerceDecimalNumber(value),
  toDriver: (value: number | string | null) => {
    if (value === null) {
      return null;
    }
    if (typeof value === 'number') {
      return value;
    }
    return coerceDecimalNumber(value);
  },
});
