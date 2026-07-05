/**
 * Explicit JST business-time API (Workers UTC instant ↔ business calendar date / date-time).
 *
 * @remarks
 * - The DB stays on JST. The app does not implicitly rely on the mysql2 `timezone` option; it goes
 *   through this module to handle JST.
 * - Converting to the MySQL wire format is the responsibility of {@link ../db/jst.js | db/jst}.
 * - Do not use a `Date`'s local getters (`getHours`, etc.) for business-time decisions.
 *
 * @packageDocumentation
 */

import { BUSINESS_TIMEZONE } from './types.js';
import type { BusinessDate, BusinessDateTime } from './types.js';

export { BUSINESS_TIMEZONE, type BusinessDate, type BusinessDateTime };

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Shift an instant so it can be read as a business-TZ wall clock (extract fields with `getUTC*`). */
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

/**
 * The JST business calendar date of a reference instant.
 *
 * @param ref - the instant to read; defaults to now.
 * @returns the business date as `YYYY-MM-DD`.
 * @example
 * today(new Date('2026-07-05T20:00:00Z')); // → '2026-07-06' (JST)
 */
export function today(ref: Date = new Date()): BusinessDate {
  return toBusinessDate(ref);
}

/**
 * Convert a UTC instant to a JST business calendar date.
 *
 * @param instant - the UTC instant to convert.
 * @returns the business date as `YYYY-MM-DD`.
 */
export function toBusinessDate(instant: Date): BusinessDate {
  const wall = toWallClock(instant);
  return `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}`;
}

/**
 * Normalize a client / DB input to a JST business calendar date `YYYY-MM-DD`.
 *
 * - A string already in `YYYY-MM-DD` form is returned as-is, **without** constructing a `Date`
 *   (a birthday is a calendar day, not an instant).
 * - ISO 8601 and similar values are converted to a JST calendar date via their instant.
 * - Nullish / empty / invalid inputs yield `null`.
 *
 * @param value - the string, `Date`, or nullish value to normalize.
 * @returns the business date as `YYYY-MM-DD`, or `null` when the input cannot be resolved.
 * @example
 * normalizeBusinessDate('1990-01-15');            // → '1990-01-15' (unchanged)
 * normalizeBusinessDate('2026-07-05T20:00:00Z');  // → '2026-07-06' (JST)
 * normalizeBusinessDate('');                       // → null
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

/**
 * Convert a UTC instant to a JST business date-time (`YYYY-MM-DD HH:mm:ss`).
 *
 * @param instant - the UTC instant to convert.
 * @returns the business date-time string.
 * @example
 * toBusinessDateTime(new Date('2026-07-05T21:00:00Z')); // → '2026-07-06 06:00:00' (JST)
 */
export function toBusinessDateTime(instant: Date): BusinessDateTime {
  const wall = toWallClock(instant);
  return `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())} ${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}:${pad2(wall.getUTCSeconds())}`;
}

/** Default pattern for the Nest / foodlabel / winecode `helper.formatDate`. */
export const DEFAULT_BUSINESS_DATETIME_PATTERN = 'YYYY-MM-DDThh:mm:ss' as const;

/**
 * Format an instant in the business TZ, compatible with the Nest `helper.formatDate`.
 *
 * Supported tokens: `YYYY` / `MM` / `DD` / `hh` / `mm` / `ss`, plus `S` for the source instant's
 * milliseconds (matching the Nest reference implementation).
 *
 * @param instant - the UTC instant to format.
 * @param pattern - the format pattern; defaults to {@link DEFAULT_BUSINESS_DATETIME_PATTERN}.
 * @returns the formatted string.
 * @example
 * formatBusinessDateTime(new Date('2026-07-05T21:00:00Z')); // → '2026-07-06T06:00:00' (JST)
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

/**
 * Parse a JST business date-time string into a UTC instant. Accepts a space or `T` separator
 * (`YYYY-MM-DD HH:mm:ss` or `YYYY-MM-DDTHH:mm:ss`).
 *
 * @param value - the business date-time string to parse.
 * @returns the corresponding UTC instant.
 * @throws RangeError when `value` is not a valid business date-time.
 * @example
 * parseBusinessDateTime('2026-07-06 06:00:00'); // → 2026-07-05T21:00:00Z
 */
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

/**
 * The UTC instant of `00:00:00` on a JST business calendar date.
 *
 * @param date - the business date as `YYYY-MM-DD`.
 * @returns the UTC instant at the start of that business day.
 */
export function startOfBusinessDay(date: BusinessDate): Date {
  return businessDateTimeInstant(date, '00:00:00');
}

/**
 * The UTC instant of `23:59:59` on a JST business calendar date.
 *
 * @param date - the business date as `YYYY-MM-DD`.
 * @returns the UTC instant at the end of that business day.
 */
export function endOfBusinessDay(date: BusinessDate): Date {
  return businessDateTimeInstant(date, '23:59:59');
}

/**
 * Convert a JST business calendar date + wall-clock time to a UTC instant.
 *
 * @param date - the business date as `YYYY-MM-DD`.
 * @param time - the wall-clock time as `HH:mm:ss` (or `HH:mm`).
 * @returns the corresponding UTC instant.
 * @throws RangeError when `date` or `time` is malformed.
 * @example
 * businessDateTimeInstant('2026-07-06', '06:00:00'); // → 2026-07-05T21:00:00Z
 */
export function businessDateTimeInstant(date: BusinessDate, time: string): Date {
  const [y, mo, d] = parseYmd(date);
  const [h, mi, s] = parseHms(time);
  const offsetHours = BUSINESS_TIMEZONE.offsetMinutes / 60;
  return new Date(Date.UTC(y, mo - 1, d, h - offsetHours, mi, s, 0));
}

/**
 * Add a number of calendar days to a JST business calendar date.
 *
 * @param date - the starting business date as `YYYY-MM-DD`.
 * @param days - the number of calendar days to add (may be negative).
 * @returns the resulting business date as `YYYY-MM-DD`.
 * @example
 * addBusinessDays('2026-07-06', 3); // → '2026-07-09'
 */
export function addBusinessDays(date: BusinessDate, days: number): BusinessDate {
  const anchor = businessDateTimeInstant(date, '12:00:00');
  return toBusinessDate(new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000));
}

/**
 * The full years of age on a business calendar date (a birthday is a `BusinessDate`, not an instant).
 *
 * @param birthDate - the birth date as `YYYY-MM-DD`.
 * @param asOfDate - the reference business date; defaults to {@link today}.
 * @returns the age in completed years.
 * @example
 * ageOnBusinessDate('1990-07-10', '2026-07-06'); // → 35
 */
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
