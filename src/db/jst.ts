/**
 * MySQL / Drizzle 向け JST ワイヤ変換と DATE 列正規化。
 *
 * @remarks
 * 業務時刻の意味論は {@link ../business-time/index.js | business-time} に集約する。
 * このモジュールは「MySQL 接続既定」「DATE 列の toDriver」、列 `customType` params のみを担う。
 */

import { normalizeBusinessDate } from '../business-time/index.js';
import type { BusinessDate } from '../business-time/index.js';

/** mysql2 接続 `timezone` 既定（既存 JST DB 運用）。 */
export const MYSQL_TIMEZONE = '+09:00';

/**
 * クライアント入力を MySQL `DATE` 列向け `YYYY-MM-DD`（JST 業務暦日）へ正規化。
 * ISO 8601 / `YYYY-MM-DD` / 空文字を受け付ける。`YYYY-MM-DD` は Date 化せずそのまま渡す。
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
