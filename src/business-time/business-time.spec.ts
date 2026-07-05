import { describe, it, expect } from 'vitest';
import {
  addBusinessDays,
  ageOnBusinessDate,
  businessDateTimeInstant,
  endOfBusinessDay,
  formatBusinessDateTime,
  normalizeBusinessDate,
  parseBusinessDateTime,
  startOfBusinessDay,
  today,
  toBusinessDate,
  toBusinessDateTime,
} from './index.js';

describe('normalizeBusinessDate', () => {
  it('YYYY-MM-DD 文字列は Date 化せずそのまま返す', () => {
    expect(normalizeBusinessDate('1990-07-05')).toBe('1990-07-05');
  });

  it('ISO 8601 Z は JST 暦日へ変換する', () => {
    expect(normalizeBusinessDate('1990-07-05T00:00:00Z')).toBe('1990-07-05');
    expect(normalizeBusinessDate('1990-07-05T15:00:00Z')).toBe('1990-07-06');
  });

  it('Date instant は JST 暦日へ変換する', () => {
    expect(normalizeBusinessDate(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });

  it('nullish / 空 / 不正は null', () => {
    expect(normalizeBusinessDate(null)).toBeNull();
    expect(normalizeBusinessDate('')).toBeNull();
    expect(normalizeBusinessDate('not-a-date')).toBeNull();
  });
});

describe('toBusinessDate / today', () => {
  it('UTC を JST 業務暦日に変換する', () => {
    expect(toBusinessDate(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });

  it('UTC 15:00 跨ぎは翌業務日', () => {
    expect(toBusinessDate(new Date('2026-06-26T15:00:00Z'))).toBe('2026-06-27');
  });

  it('today は ref の業務暦日', () => {
    expect(today(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });
});

describe('toBusinessDateTime / formatBusinessDateTime', () => {
  it('業務日時を MySQL 互換形式で返す', () => {
    expect(toBusinessDateTime(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01 09:00:00');
  });

  it('カスタムパターン（foodlabel 既定）', () => {
    expect(formatBusinessDateTime(new Date('2026-01-01T00:00:00Z'), 'YYYY-MM-DDThh:mm:ss')).toBe(
      '2026-01-01T09:00:00',
    );
  });

  it('S トークンはミリ秒を3桁で埋める', () => {
    const instant = new Date('2026-01-01T00:00:00.005Z');
    expect(formatBusinessDateTime(instant, 'YYYY-MM-DDThh:mm:ss.SSS')).toBe('2026-01-01T09:00:00.005');
  });
});

describe('businessDateTimeInstant / parseBusinessDateTime', () => {
  it('JST 6:00 → UTC instant（talk 境界）', () => {
    expect(businessDateTimeInstant('2026-06-15', '06:00:00').toISOString()).toBe(
      '2026-06-14T21:00:00.000Z',
    );
  });

  it('parse ↔ to が往復一致する', () => {
    const instant = new Date('2026-03-05T10:30:45Z');
    const s = toBusinessDateTime(instant);
    expect(parseBusinessDateTime(s).getTime()).toBe(
      businessDateTimeInstant(toBusinessDate(instant), '19:30:45').getTime(),
    );
  });

  it('startOfBusinessDay / endOfBusinessDay', () => {
    expect(startOfBusinessDay('2026-07-05').toISOString()).toBe('2026-07-04T15:00:00.000Z');
    expect(endOfBusinessDay('2026-07-05').toISOString()).toBe('2026-07-05T14:59:59.000Z');
  });
});

describe('addBusinessDays', () => {
  it('暦日を加算する', () => {
    expect(addBusinessDays('2026-01-01', 1)).toBe('2026-01-02');
    expect(addBusinessDays(today(new Date('2026-01-01T00:00:00Z')), 1)).toBe('2026-01-02');
  });
});

describe('ageOnBusinessDate', () => {
  it('業務暦日で満年齢を計算する', () => {
    expect(ageOnBusinessDate('2000-06-14', '2026-06-15')).toBe(26);
    expect(ageOnBusinessDate('2000-06-16', '2026-06-15')).toBe(25);
  });

  it('asOf 省略時は today(ref) 相当の暦日を使う', () => {
    expect(ageOnBusinessDate('2000-01-01', today(new Date('2026-06-15T00:00:00Z')))).toBe(26);
  });
});
