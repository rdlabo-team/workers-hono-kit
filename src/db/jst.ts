/**
 * MySQL / Drizzle 向け JST ワイヤ変換と DATE 列正規化。
 *
 * @remarks
 * 業務時刻の意味論は {@link ../business-time/index.js | business-time} に集約する。
 * このモジュールは「MySQL へどう渡すか」「DATE 列の toDriver」のみを担う。
 */

import {
  formatBusinessDateTime,
  toBusinessDate,
  toBusinessDateTime,
  today,
  addBusinessDays,
  businessDateTimeInstant,
  ageOnBusinessDate,
  type BusinessDate,
  type BusinessDateTime,
} from '../business-time/index.js';

/** mysql2 接続 `timezone` 既定（既存 JST DB 運用）。 */
export const MYSQL_TIMEZONE = '+09:00';

/** @deprecated {@link MYSQL_TIMEZONE} と同値。 */
export const DEFAULT_TZ_OFFSET_MINUTES = 540;

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
    return tz === 'Z' ? 0 : DEFAULT_TZ_OFFSET_MINUTES;
  }
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (!m) {
    return DEFAULT_TZ_OFFSET_MINUTES;
  }
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10));
}

/** @deprecated {@link toBusinessDate} の内部用。新規コードは business-time を使う。 */
export function toJstWallClock(date: Date): Date {
  return new Date(date.getTime() + DEFAULT_TZ_OFFSET_MINUTES * 60_000);
}

/** @deprecated {@link toJstWallClock} の一般化。 */
export function toTzWallClock(date: Date, offsetMinutes: number = DEFAULT_TZ_OFFSET_MINUTES): Date {
  return new Date(date.getTime() + offsetMinutes * 60_000);
}

export type FormatJstDateOptions = {
  offsetMinutes?: number;
  nullIfFalsy?: boolean;
  millisecondsSource?: 'wall' | 'instant';
};

/**
 * @deprecated {@link formatBusinessDateTime} を使う。
 * winecode 互換のため offset / millisecondsSource を残すが、JST 固定へ移行予定。
 */
export function formatJstDate(
  date: Date | null | undefined,
  format = 'YYYY-MM-DDThh:mm:ss',
  options: FormatJstDateOptions = {},
): string | null {
  const { offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES, nullIfFalsy = false } = options;
  if (nullIfFalsy && !date) {
    return null;
  }
  if (offsetMinutes !== DEFAULT_TZ_OFFSET_MINUTES) {
    const wall = toTzWallClock(date as Date, offsetMinutes);
    let out = format;
    out = out.replace(/YYYY/g, String(wall.getUTCFullYear()));
    out = out.replace(/MM/g, ('0' + (wall.getUTCMonth() + 1)).slice(-2));
    out = out.replace(/DD/g, ('0' + wall.getUTCDate()).slice(-2));
    out = out.replace(/hh/g, ('0' + wall.getUTCHours()).slice(-2));
    out = out.replace(/mm/g, ('0' + wall.getUTCMinutes()).slice(-2));
    out = out.replace(/ss/g, ('0' + wall.getUTCSeconds()).slice(-2));
    return out;
  }
  return formatBusinessDateTime(date as Date, format);
}

/** @deprecated {@link ageOnBusinessDate} + {@link toBusinessDate} を使う。 */
export function ageInJst(birthDate: Date, nowDate: Date = new Date()): number {
  return ageOnBusinessDate(toBusinessDate(birthDate), today(nowDate));
}

/** @deprecated {@link ageInJst} の一般化。 */
export function ageInTz(
  birthDate: Date,
  nowDate: Date = new Date(),
  offsetMinutes: number = DEFAULT_TZ_OFFSET_MINUTES,
): number {
  if (offsetMinutes === DEFAULT_TZ_OFFSET_MINUTES) {
    return ageInJst(birthDate, nowDate);
  }
  const nowWall = toTzWallClock(nowDate, offsetMinutes);
  const birthWall = toTzWallClock(birthDate, offsetMinutes);
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
  offsetMinutes: number = DEFAULT_TZ_OFFSET_MINUTES,
): string {
  if (offsetMinutes === DEFAULT_TZ_OFFSET_MINUTES) {
    return jstDateString(ref, offsetDays);
  }
  const wall = toTzWallClock(new Date(ref.getTime() + offsetDays * 24 * 60 * 60 * 1000), offsetMinutes);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${wall.getUTCFullYear()}-${p(wall.getUTCMonth() + 1)}-${p(wall.getUTCDate())}`;
}

/**
 * @deprecated {@link businessDateTimeInstant} + {@link today} / {@link addBusinessDays} を使う。
 */
export function jstBoundaryAsUtc(ref: Date, dayOffset: number, hour: number): Date {
  const date = dayOffset === 0 ? today(ref) : addBusinessDays(today(ref), dayOffset);
  return businessDateTimeInstant(date, `${String(hour).padStart(2, '0')}:00:00`);
}

/** @deprecated {@link jstBoundaryAsUtc} の一般化。 */
export function tzBoundaryAsUtc(
  ref: Date,
  dayOffset: number,
  hour: number,
  offsetMinutes: number = DEFAULT_TZ_OFFSET_MINUTES,
): Date {
  if (offsetMinutes === DEFAULT_TZ_OFFSET_MINUTES) {
    return jstBoundaryAsUtc(ref, dayOffset, hour);
  }
  const wall = toTzWallClock(ref, offsetMinutes);
  const offsetHours = offsetMinutes / 60;
  return new Date(
    Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + dayOffset, hour - offsetHours, 0, 0, 0),
  );
}

/**
 * クライアント入力を MySQL `DATE` 列向け `YYYY-MM-DD`（JST 業務暦日）へ正規化。
 * ISO 8601 / `YYYY-MM-DD` / 空文字を受け付ける。
 */
export function toJstDate(value: string | null | undefined): BusinessDate | null {
  if (!value) {
    return null;
  }
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    return null;
  }
  return toBusinessDate(new Date(ms));
}

export const jstTimestampParams = (fsp?: number): { dataType: () => string } => ({
  dataType: () => (fsp != null ? `timestamp(${fsp})` : 'timestamp'),
});

export const jstDatetimeParams = (fsp?: number): { dataType: () => string } => ({
  dataType: () => (fsp != null ? `datetime(${fsp})` : 'datetime'),
});

export const jstDateParams = (): {
  dataType: () => string;
  toDriver: (value: string | null) => string | null;
} => ({
  dataType: () => 'date',
  toDriver: (value: string | null) => toJstDate(value),
});
