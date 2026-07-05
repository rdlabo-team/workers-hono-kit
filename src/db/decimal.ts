/**
 * MySQL `DECIMAL` 列向け Drizzle `customType` params。
 *
 * @remarks
 * - **読込（SELECT）**: `fromDriver` で driver 値（`number` / `string` / `null`）を JS `number | null` に統一。
 *   接続 `decimalNumbers: true`（{@link hyperdriveConnectionOptions} 既定）と併用し、Drizzle builder 経路でも
 *   文字列 `"0"` / `"100.00"` が混ざったときに 0 を潰さず number へ揃える。
 * - **書込（INSERT/UPDATE）**: `toDriver` で number をそのまま mysql2 に bind（`String()` 変換不要）。
 * - 生 SQL `db.read` は接続 `decimalNumbers: true` が効く。列型の `fromDriver` は Drizzle `select` 経路向け。
 */

export interface DecimalNumberConfig {
  precision: number;
  scale: number;
}

/**
 * mysql2 / Drizzle から届いた DECIMAL 値を JS `number | null` へ正規化する。
 * `0` は falsy 落ちしないようそのまま保持する。
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
 * `customType` 用 params。高度な用途向け。通常は {@link decimalNumber} 列ヘルパーを使う。
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
