/**
 * JST 業務時刻の明示 API（Workers UTC instant ↔ 業務暦日/日時）。
 *
 * @remarks
 * - DB は JST 運用のまま。アプリは mysql2 `timezone` に暗黙依存せず、ここ経由で JST を扱う。
 * - MySQL ワイヤ形式への変換は {@link ../db/jst.js | db/jst} の責務。
 * - `Date` の local getter（`getHours` 等）は業務判定に使わない。
 *
 * @packageDocumentation
 */

import { BUSINESS_TIMEZONE } from './types.js';
import type { BusinessDate, BusinessDateTime } from './types.js';

export { BUSINESS_TIMEZONE, type BusinessDate, type BusinessDateTime };

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** instant を業務 TZ 壁時計として読むためのシフト（`getUTC*` で成分を得る）。 */
function toWallClock(instant: Date): Date {
  return new Date(instant.getTime() + BUSINESS_TIMEZONE.offsetMinutes * 60_000);
}

function parseYmd(date: BusinessDate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) {
    throw new RangeError(`Invalid BusinessDate: ${date}`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function parseHms(time: string): [number, number, number] {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!m) {
    throw new RangeError(`Invalid business time: ${time}`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}

/** 参照 instant の JST 業務暦日。 */
export function today(ref: Date = new Date()): BusinessDate {
  return toBusinessDate(ref);
}

/** UTC instant → JST 業務暦日。 */
export function toBusinessDate(instant: Date): BusinessDate {
  const wall = toWallClock(instant);
  return `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}`;
}

/**
 * クライアント / DB 入力を JST 業務暦日 `YYYY-MM-DD` へ正規化する。
 *
 * - 既に `YYYY-MM-DD` の文字列は **Date 化せず**そのまま返す（誕生日は instant ではない）。
 * - ISO 8601 等は instant 経由で JST 暦日へ変換。
 * - nullish / 空 / 不正は `null`。
 */
export function normalizeBusinessDate(value: string | Date | null | undefined): BusinessDate | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return toBusinessDate(value);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const isoDatePrefix = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (isoDatePrefix && !trimmed.includes('T') && !trimmed.includes(' ')) {
    return isoDatePrefix[1];
  }
  const ms = new Date(trimmed).getTime();
  if (Number.isNaN(ms)) {
    return null;
  }
  return toBusinessDate(new Date(ms));
}

/** UTC instant → JST 業務日時（`YYYY-MM-DD HH:mm:ss`）。 */
export function toBusinessDateTime(instant: Date): BusinessDateTime {
  const wall = toWallClock(instant);
  return `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())} ${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}:${pad2(wall.getUTCSeconds())}`;
}

/** Nest / foodlabel / winecode `helper.formatDate` 既定パターン。 */
export const DEFAULT_BUSINESS_DATETIME_PATTERN = 'YYYY-MM-DDThh:mm:ss' as const;

/**
 * Nest `helper.formatDate` 互換のパターン整形（業務 TZ）。
 * `S` トークンは元 instant のミリ秒（Nest 正本）。
 */
export function formatBusinessDateTime(instant: Date, pattern: string = DEFAULT_BUSINESS_DATETIME_PATTERN): string {
  const wall = toWallClock(instant);
  let out = pattern;
  out = out.replace(/YYYY/g, String(wall.getUTCFullYear()));
  out = out.replace(/MM/g, pad2(wall.getUTCMonth() + 1));
  out = out.replace(/DD/g, pad2(wall.getUTCDate()));
  out = out.replace(/hh/g, pad2(wall.getUTCHours()));
  out = out.replace(/mm/g, pad2(wall.getUTCMinutes()));
  out = out.replace(/ss/g, pad2(wall.getUTCSeconds()));
  const matched = out.match(/S/g);
  if (matched) {
    const milliSeconds = String(instant.getMilliseconds()).padStart(3, '0');
    const length = matched.length;
    for (let i = 0; i < length; i++) {
      out = out.replace(/S/, milliSeconds.substring(i, i + 1));
    }
  }
  return out;
}

/** JST 業務日時文字列 → UTC instant。`YYYY-MM-DD HH:mm:ss` / `T` 区切りを受け付ける。 */
export function parseBusinessDateTime(value: BusinessDateTime): Date {
  const normalized = value.includes('T') ? value.replace('T', ' ') : value;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(normalized);
  if (!m) {
    throw new RangeError(`Invalid BusinessDateTime: ${value}`);
  }
  const [, y, mo, d, h, mi, s] = m;
  const offsetHours = BUSINESS_TIMEZONE.offsetMinutes / 60;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - offsetHours, Number(mi), Number(s), 0));
}

/** JST 業務暦日の 00:00:00 を表す UTC instant。 */
export function startOfBusinessDay(date: BusinessDate): Date {
  return businessDateTimeInstant(date, '00:00:00');
}

/** JST 業務暦日の 23:59:59 を表す UTC instant。 */
export function endOfBusinessDay(date: BusinessDate): Date {
  return businessDateTimeInstant(date, '23:59:59');
}

/**
 * JST 業務暦日 + 壁時計時刻 → UTC instant。
 * @example businessDateTimeInstant('2026-07-05', '06:00:00')
 */
export function businessDateTimeInstant(date: BusinessDate, time: string): Date {
  const [y, mo, d] = parseYmd(date);
  const [h, mi, s] = parseHms(time);
  const offsetHours = BUSINESS_TIMEZONE.offsetMinutes / 60;
  return new Date(Date.UTC(y, mo - 1, d, h - offsetHours, mi, s, 0));
}

/** JST 業務暦日に日数を加算（暦日単位）。 */
export function addBusinessDays(date: BusinessDate, days: number): BusinessDate {
  const anchor = businessDateTimeInstant(date, '12:00:00');
  return toBusinessDate(new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000));
}

/** 業務暦日基準の満年齢（誕生日は instant ではなく BusinessDate）。 */
export function ageOnBusinessDate(birthDate: BusinessDate, asOfDate?: BusinessDate): number {
  const asOf = asOfDate ?? today();
  const [by, bm, bd] = parseYmd(birthDate);
  const [ay, am, ad] = parseYmd(asOf);
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) {
    age--;
  }
  return age;
}
