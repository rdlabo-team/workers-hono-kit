/**
 * MySQL / Drizzle 向け JST ワイヤ変換と DATE 列正規化。
 *
 * @remarks
 * 業務時刻の意味論は {@link ../business-time/index.js | business-time} に集約する。
 * このモジュールは「MySQL へどう渡すか」「DATE 列の toDriver」のみを担う。
 */

import {
  formatBusinessDateTime,
  normalizeBusinessDate,
  toBusinessDate,
  toBusinessDateTime,
  today,
  addBusinessDays,
  businessDateTimeInstant,
  ageOnBusinessDate,
} from '../business-time/index.js';
import type { BusinessDate, BusinessDateTime } from '../business-time/index.js';

/** mysql2 接続 `timezone` 既定（既存 JST DB 運用）。 */
export const MYSQL_TIMEZONE = '+09:00';

/** JST オフセット（分）。非公開実装と {@link DEFAULT_TZ_OFFSET_MINUTES} の正本。 */
const JST_OFFSET_MINUTES = 540;

const pad2 = (n: number): string => String(n).padStart(2, '0');

function wallClockShift(date: Date, offsetMinutes: number): Date {
  return new Date(date.getTime() + offsetMinutes * 60_000);
}

/** @deprecated {@link MYSQL_TIMEZONE} と同値。 */
export const DEFAULT_TZ_OFFSET_MINUTES = JST_OFFSET_MINUTES;

/**
 * UTC instant を MySQL DATETIME 互換の JST 業務日時文字列へ。
 * 中身は {@link toBusinessDateTime} と同じ（ワイヤ責務の明示用エイリアス）。
 */
export function toMysqlDateTime(instant: Date): BusinessDateTime {
  return toBusinessDateTime(instant);
}

/**
 * `DB_TIMEZONE` 等の `+09:00` / `-05:00` / `Z` を分に変換する。
 * mysql2 接続オプション専用。業務時刻は {@link BUSINESS_TIMEZONE} 固定。
 *
 * @deprecated フリートは JST 固定。接続は {@link MYSQL_TIMEZONE} を使う。
 */
export function parseTzOffsetMinutes(tz: string | undefined): number {
  if (!tz || tz === 'Z') {
    return tz === 'Z' ? 0 : JST_OFFSET_MINUTES;
  }
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (!m) {
    return JST_OFFSET_MINUTES;
  }
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

/** @deprecated {@link toBusinessDate} の内部用。新規コードは business-time を使う。 */
export function toJstWallClock(date: Date): Date {
  return wallClockShift(date, JST_OFFSET_MINUTES);
}

/** @deprecated {@link toJstWallClock} の一般化。 */
export function toTzWallClock(date: Date, offsetMinutes: number = JST_OFFSET_MINUTES): Date {
  return wallClockShift(date, offsetMinutes);
}

/**
 * {@link formatJstDate} のオプション（winecode 互換 shim）。
 *
 * @remarks `millisecondsSource` は現状常に instant ミリ秒（`wall` 指定も同じ）。
 */
export interface FormatJstDateOptions {
  offsetMinutes?: number;
  nullIfFalsy?: boolean;
  millisecondsSource?: 'wall' | 'instant';
}

/**
 * @deprecated {@link formatBusinessDateTime} を使う。
 * winecode 互換のため offset / millisecondsSource を残すが、JST 固定へ移行予定。
 */
export function formatJstDate(
  date: Date | null | undefined,
  format = 'YYYY-MM-DDThh:mm:ss',
  options: FormatJstDateOptions = {},
): string | null {
  const { offsetMinutes = JST_OFFSET_MINUTES, nullIfFalsy: _nullIfFalsy = false } = options;
  if (!date) {
    return null;
  }
  if (offsetMinutes !== JST_OFFSET_MINUTES) {
    const wall = wallClockShift(date, offsetMinutes);
    let out = format;
    out = out.replace(/YYYY/g, String(wall.getUTCFullYear()));
    out = out.replace(/MM/g, pad2(wall.getUTCMonth() + 1));
    out = out.replace(/DD/g, pad2(wall.getUTCDate()));
    out = out.replace(/hh/g, pad2(wall.getUTCHours()));
    out = out.replace(/mm/g, pad2(wall.getUTCMinutes()));
    out = out.replace(/ss/g, pad2(wall.getUTCSeconds()));
    return out;
  }
  return formatBusinessDateTime(date, format);
}

/** @deprecated {@link ageOnBusinessDate} + {@link toBusinessDate} を使う。 */
export function ageInJst(birthDate: Date, nowDate: Date = new Date()): number {
  return ageOnBusinessDate(toBusinessDate(birthDate), today(nowDate));
}

/** @deprecated {@link ageInJst} の一般化。 */
export function ageInTz(
  birthDate: Date,
  nowDate: Date = new Date(),
  offsetMinutes: number = JST_OFFSET_MINUTES,
): number {
  if (offsetMinutes === JST_OFFSET_MINUTES) {
    return ageOnBusinessDate(toBusinessDate(birthDate), today(nowDate));
  }
  const nowWall = wallClockShift(nowDate, offsetMinutes);
  const birthWall = wallClockShift(birthDate, offsetMinutes);
  let age = nowWall.getUTCFullYear() - birthWall.getUTCFullYear();
  const m = nowWall.getUTCMonth() - birthWall.getUTCMonth();
  if (m < 0 || (m === 0 && nowWall.getUTCDate() < birthWall.getUTCDate())) {
    age--;
  }
  return age;
}

/** @deprecated {@link today} / {@link addBusinessDays} を使う。 */
export function jstDateString(ref: Date = new Date(), offsetDays = 0): BusinessDate {
  return offsetDays === 0 ? today(ref) : addBusinessDays(today(ref), offsetDays);
}

/** @deprecated {@link jstDateString} の一般化。 */
export function tzDateString(
  ref: Date = new Date(),
  offsetDays = 0,
  offsetMinutes: number = JST_OFFSET_MINUTES,
): string {
  if (offsetMinutes === JST_OFFSET_MINUTES) {
    return offsetDays === 0 ? today(ref) : addBusinessDays(today(ref), offsetDays);
  }
  const wall = wallClockShift(new Date(ref.getTime() + offsetDays * 24 * 60 * 60 * 1000), offsetMinutes);
  return `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}`;
}

/**
 * @deprecated {@link businessDateTimeInstant} + {@link today} / {@link addBusinessDays} を使う。
 */
export function jstBoundaryAsUtc(ref: Date, dayOffset: number, hour: number): Date {
  const date = dayOffset === 0 ? today(ref) : addBusinessDays(today(ref), dayOffset);
  return businessDateTimeInstant(date, `${pad2(hour)}:00:00`);
}

/** @deprecated {@link jstBoundaryAsUtc} の一般化。 */
export function tzBoundaryAsUtc(
  ref: Date,
  dayOffset: number,
  hour: number,
  offsetMinutes: number = JST_OFFSET_MINUTES,
): Date {
  if (offsetMinutes === JST_OFFSET_MINUTES) {
    const date = dayOffset === 0 ? today(ref) : addBusinessDays(today(ref), dayOffset);
    return businessDateTimeInstant(date, `${pad2(hour)}:00:00`);
  }
  const wall = wallClockShift(ref, offsetMinutes);
  const offsetHours = offsetMinutes / 60;
  return new Date(
    Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + dayOffset, hour - offsetHours, 0, 0, 0),
  );
}

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
