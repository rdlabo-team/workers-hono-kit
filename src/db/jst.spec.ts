import { describe, it, expect } from 'vitest';
import { toJstDate } from './jst';

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
