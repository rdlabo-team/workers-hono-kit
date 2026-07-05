/* eslint-disable @typescript-eslint/no-deprecated -- tests cover deprecated JST shims kept for winecode compat */
import { describe, it, expect } from 'vitest';
import {
  ageInJst,
  formatJstDate,
  jstBoundaryAsUtc,
  jstDateString,
  parseTzOffsetMinutes,
  toJstDate,
  toJstWallClock,
} from './jst.js';

describe('toJstDate', () => {
  it('returns null for nullish/blank input', () => {
    expect(toJstDate(null)).toBeNull();
    expect(toJstDate(undefined)).toBeNull();
    expect(toJstDate('')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(toJstDate('not-a-date')).toBeNull();
  });

  it('normalizes an ISO 8601 (Z) string to a YYYY-MM-DD JST date', () => {
    expect(toJstDate('2026-06-22T00:00:00.000Z')).toBe('2026-06-22');
  });

  it('passes through an already-normalized YYYY-MM-DD (idempotent for re-insert)', () => {
    expect(toJstDate('2024-11-05')).toBe('2024-11-05');
  });

  it('applies the JST (+9h) offset, rolling to the next day past 15:00 UTC', () => {
    expect(toJstDate('2026-06-22T15:30:00.000Z')).toBe('2026-06-23');
    expect(toJstDate('2026-06-22T20:00:00.000Z')).toBe('2026-06-23');
  });
});

// foodlabel/hono/src/api/shared/helper.service.spec.ts と同一観点。
describe('formatJstDate [foodlabel parity]', () => {
  it('UTC を JST(+9h) に補正して既定フォーマットで返す', () => {
    expect(formatJstDate(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T09:00:00');
  });

  it('UTC 15:00 跨ぎは JST で翌日になる（日付境界の回帰）', () => {
    expect(formatJstDate(new Date('2026-06-26T15:00:00Z'), 'YYYY-MM-DD')).toBe('2026-06-27');
  });

  it('カスタムフォーマット（日付のみ）を反映する', () => {
    expect(formatJstDate(new Date('2026-12-31T10:00:00Z'), 'YYYY-MM-DD')).toBe('2026-12-31');
  });

  it('月日を 0 埋めする', () => {
    expect(formatJstDate(new Date('2026-03-05T00:00:00Z'), 'YYYY-MM-DD')).toBe('2026-03-05');
  });
});

describe('formatJstDate [winecode parity]', () => {
  it('offsetMinutes を反映する', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(formatJstDate(d, 'YYYY-MM-DD hh:mm', { offsetMinutes: 0 })).toBe('2026-01-01 00:00');
    expect(formatJstDate(d, 'YYYY-MM-DD hh:mm', { offsetMinutes: 540 })).toBe('2026-01-01 09:00');
  });

  it('millisecondsSource=instant は元 Date の ms を使う（winecode）', () => {
    const d = new Date('2026-01-01T00:00:00.123Z');
    expect(formatJstDate(d, 'SSS', { millisecondsSource: 'instant' })).toBe('123');
    expect(formatJstDate(d, 'SSS', { millisecondsSource: 'wall' })).toBe('123');
  });

  it('nullIfFalsy で falsy を null にする（tipsys）', () => {
    expect(formatJstDate(null, 'YYYY-MM-DD', { nullIfFalsy: true })).toBeNull();
    expect(formatJstDate(undefined, 'YYYY-MM-DD', { nullIfFalsy: true })).toBeNull();
  });
});

describe('parseTzOffsetMinutes', () => {
  it('未設定は JST 540 分', () => {
    expect(parseTzOffsetMinutes(undefined)).toBe(540);
  });

  it('Z は UTC 0 分', () => {
    expect(parseTzOffsetMinutes('Z')).toBe(0);
  });

  it('+09:00 を 540 分にする', () => {
    expect(parseTzOffsetMinutes('+09:00')).toBe(540);
  });
});

describe('ageInJst', () => {
  it('JST 暦日で満年齢を計算する', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    expect(ageInJst(new Date('2000-06-14'), now)).toBe(26);
    expect(ageInJst(new Date('2000-06-16'), now)).toBe(25);
  });
});

describe('jstDateString', () => {
  it('JST の YYYY-MM-DD を返す', () => {
    expect(jstDateString(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
    expect(jstDateString(new Date('2026-01-01T00:00:00Z'), 1)).toBe('2026-01-02');
  });
});

describe('jstBoundaryAsUtc', () => {
  it('JST 6:00 境界を UTC Instant として組み立てる', () => {
    const ref = new Date('2026-06-15T12:00:00Z');
    expect(jstBoundaryAsUtc(ref, 0, 6).toISOString()).toBe('2026-06-14T21:00:00.000Z');
  });
});

describe('toJstWallClock', () => {
  it('getUTC* で JST 壁時計成分を読める', () => {
    expect(toJstWallClock(new Date('2026-01-01T00:00:00Z')).getUTCHours()).toBe(9);
  });
});
