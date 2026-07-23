import { int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import {
  decodeOfflineSnapshotCursor,
  encodeOfflineSnapshotCursor,
  defineRestDbMethodConverter,
  fromTinyIntFlag,
  replicaNowIso,
  replicaTimestampMs,
  toReplicaDateOnly,
  toReplicaIsoDatetime,
  toTinyIntFlag,
} from './index.js';

const _exampleFoods = mysqlTable('example_foods', {
  id: int().autoincrement().primaryKey(),
  groupId: int().notNull(),
  name: varchar({ length: 200 }).notNull(),
  memo: varchar({ length: 200 }),
});

type ExampleFoodInsert = typeof _exampleFoods.$inferInsert;

interface ExampleAllergenRow {
  threadId: number;
  value: string;
}

interface ExampleFoodMethodScheme {
  id: number;
  groupId: number;
  name: string;
  memo?: string;
  allergens: string[];
}

interface ExampleFoodTableScheme {
  foods: ExampleFoodInsert[];
  allergens: ExampleAllergenRow[];
}

interface ExampleCreateFoodMethodScheme {
  groupId: number;
  name: string;
  memo: string | null;
}

interface ExampleCreateFoodTableScheme {
  foods: Omit<ExampleFoodInsert, 'id'>[];
}

describe('offline replica wire helpers', () => {
  it('normalizes datetime instants to canonical UTC ISO strings', () => {
    expect(toReplicaIsoDatetime('2026-07-23T19:00:00+09:00')).toBe('2026-07-23T10:00:00.000Z');
    expect(toReplicaIsoDatetime(new Date('2026-07-23T10:00:00.123Z'))).toBe('2026-07-23T10:00:00.123Z');
    expect(() => toReplicaIsoDatetime('not-a-date')).toThrow('Invalid replica datetime');
  });

  it('preserves date-only calendar values and normalizes datetime inputs', () => {
    expect(toReplicaDateOnly('2026-07-23')).toBe('2026-07-23');
    expect(toReplicaDateOnly('2026-07-23T23:00:00-03:00')).toBe('2026-07-24');
    expect(toReplicaDateOnly(null)).toBeNull();
    expect(() => toReplicaDateOnly('2026-02-30')).toThrow('Invalid replica date');
  });

  it('maps replica datetime and tinyint wire values', () => {
    expect(replicaTimestampMs('2026-07-23T10:00:00.000Z')).toBe(1_784_800_800_000);
    expect(toTinyIntFlag(true)).toBe(1);
    expect(toTinyIntFlag(0)).toBe(0);
    expect(fromTinyIntFlag(2)).toBe(true);
    expect(fromTinyIntFlag(0)).toBe(false);
  });
});

describe('offline replica clock helper', () => {
  it('uses an injectable wall clock', () => {
    expect(replicaNowIso(() => new Date('2026-07-23T10:00:00.456Z'))).toBe('2026-07-23T10:00:00.456Z');
  });
});

describe('offline snapshot cursor', () => {
  it('round-trips the journal watermark and keyset position', () => {
    const value = { watermark: 38142, sourceIndex: 2, afterId: 99 };
    expect(decodeOfflineSnapshotCursor(encodeOfflineSnapshotCursor(value))).toEqual(value);
  });

  it.each([
    '',
    'snapshot:v2:1:0:0',
    'snapshot:v1:-1:0:0',
    'snapshot:v1:1:1.5:0',
    'snapshot:v1:1:0:not-a-number',
    'snapshot:v1:1:0:0:extra',
    'snapshot:v1:::',
    'snapshot:v1:1::0',
    'snapshot:v1:1:  :0',
    'snapshot:v1:1:1e2:0',
    'snapshot:v1:1:+2:0',
    'snapshot:v1:1:-0:0',
    'snapshot:v1:01:0:0',
    'snapshot:v1:9007199254740992:0:0',
  ])('rejects malformed cursor %j', (value) => {
    expect(decodeOfflineSnapshotCursor(value)).toBeNull();
  });

  it('refuses to encode invalid positions', () => {
    expect(() => encodeOfflineSnapshotCursor({ watermark: 1, sourceIndex: -1, afterId: 0 })).toThrow(RangeError);
  });
});

describe('REST DB method converter', () => {
  const converter = defineRestDbMethodConverter<ExampleFoodMethodScheme, ExampleFoodTableScheme>({
    toMethodScheme: ({ foods, allergens }) => {
      const food = foods[0];
      return {
        id: food.id,
        groupId: food.groupId,
        name: food.name,
        ...(food.memo === null ? {} : { memo: food.memo }),
        allergens: allergens.filter((row) => row.threadId === food.id).map((row) => row.value),
      };
    },
    toTableScheme: (method) => ({
      foods: [
        {
          id: method.id,
          groupId: method.groupId,
          name: method.name,
          memo: method.memo ?? null,
        },
      ],
      allergens: method.allergens.map((value) => ({ threadId: method.id, value })),
    }),
  });
  const createConverter = defineRestDbMethodConverter<ExampleCreateFoodMethodScheme, ExampleCreateFoodTableScheme>({
    toMethodScheme: ({ foods }) => foods[0],
    toTableScheme: (method) => ({ foods: [{ ...method }] }),
  });

  it('converts one REST method scheme to and from all participating tables', () => {
    const tables = converter.toTableScheme({
      id: 38142,
      groupId: 7,
      name: 'Wine',
      allergens: ['milk', 'egg'],
    });

    expect(tables).toEqual({
      foods: [{ id: 38142, groupId: 7, name: 'Wine', memo: null }],
      allergens: [
        { threadId: 38142, value: 'milk' },
        { threadId: 38142, value: 'egg' },
      ],
    });
    expect(converter.toMethodScheme(tables)).toEqual({
      id: 38142,
      groupId: 7,
      name: 'Wine',
      allergens: ['milk', 'egg'],
    });
  });

  it('requires nullable DB columns to be present in the table scheme', () => {
    const compileOnly = (): void => {
      defineRestDbMethodConverter<ExampleFoodMethodScheme, ExampleFoodTableScheme>({
        toMethodScheme: () => ({ id: 1, groupId: 1, name: 'Wine', allergens: [] }),
        toTableScheme: (method) => ({
          // @ts-expect-error memo is nullable, not optional
          foods: [{ id: method.id, groupId: method.groupId, name: method.name }],
          allergens: [],
        }),
      });
    };
    void compileOnly;
  });

  it('omits an AUTO_INCREMENT id only when the product method scheme excludes it explicitly', () => {
    expect(createConverter.toTableScheme({ groupId: 7, name: 'Wine', memo: null })).toEqual({
      foods: [{ groupId: 7, name: 'Wine', memo: null }],
    });
  });
});
