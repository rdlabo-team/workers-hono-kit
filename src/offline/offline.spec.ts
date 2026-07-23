import { describe, expect, it } from 'vitest';
import {
  defineRestDbMethodConverter,
  fromTinyIntFlag,
  replicaNowIso,
  replicaTimestampMs,
  toReplicaDateOnly,
  toReplicaIsoDatetime,
  toTinyIntFlag,
  withoutReplicaId,
  withReplicaId,
} from './index.js';

interface ExampleFoodRow {
  id: number;
  groupId: number;
  name: string;
  memo: string | null;
}

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
  foods: ExampleFoodRow[];
  allergens: ExampleAllergenRow[];
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

describe('offline replica identity and clock helpers', () => {
  it('uses an injectable wall clock', () => {
    expect(replicaNowIso(() => new Date('2026-07-23T10:00:00.456Z'))).toBe('2026-07-23T10:00:00.456Z');
  });

  it('removes and restores an id without knowing product columns', () => {
    const values = withoutReplicaId({ id: 38142, name: 'Wine', nullable: null });
    expect(values).toEqual({ name: 'Wine', nullable: null });
    expect(withReplicaId(values, 38142)).toEqual({ id: 38142, name: 'Wine', nullable: null });
  });

  it('does not allow local values to override the supplied replica id', () => {
    expect(withReplicaId({ id: 1, name: 'Wine' } as never, 38142)).toEqual({
      id: 38142,
      name: 'Wine',
    });
  });

  it('rejects an id inside typed local values', () => {
    const compileOnly = (): void => {
      // @ts-expect-error local values must not carry a remote replica id
      withReplicaId({ id: 1, name: 'Wine' }, 38142);
      // @ts-expect-error a remote replica id is required and is never generated locally
      withReplicaId({ name: 'Wine' });
    };
    void compileOnly;
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
});
