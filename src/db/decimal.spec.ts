import { describe, expect, it } from 'vitest';
import { coerceDecimalNumber, decimalNumberParams } from './decimal.js';

describe('coerceDecimalNumber', () => {
  it('number をそのまま返す（0 を含む）', () => {
    expect(coerceDecimalNumber(0)).toBe(0);
    expect(coerceDecimalNumber(100.5)).toBe(100.5);
  });

  it('文字列 DECIMAL を number に変換する', () => {
    expect(coerceDecimalNumber('0')).toBe(0);
    expect(coerceDecimalNumber('100.00')).toBe(100);
    expect(coerceDecimalNumber(' 42.5 ')).toBe(42.5);
  });

  it('null / undefined / 空文字は null', () => {
    expect(coerceDecimalNumber(null)).toBeNull();
    expect(coerceDecimalNumber(undefined)).toBeNull();
    expect(coerceDecimalNumber('')).toBeNull();
    expect(coerceDecimalNumber('   ')).toBeNull();
  });
});

describe('decimalNumberParams', () => {
  const params = decimalNumberParams({ precision: 10, scale: 2 });

  it('dataType は precision/scale を含む', () => {
    expect(params.dataType()).toBe('decimal(10,2)');
  });

  it('fromDriver / toDriver が読書を number 域に揃える', () => {
    expect(params.fromDriver('0')).toBe(0);
    expect(params.fromDriver(12.34)).toBe(12.34);
    expect(params.toDriver(0)).toBe(0);
    expect(params.toDriver('99.9')).toBe(99.9);
  });
});
