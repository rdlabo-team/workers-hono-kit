/**
 * A product-owned table bundle used by one REST API method.
 *
 * Each property represents one DB table participating in the method. Products
 * should use their exported Drizzle `$inferSelect` / `$inferInsert` types here;
 * this package deliberately knows no table names or columns.
 */
/** Require every column represented by a product DB row type. */
type CompleteDbRow<TRow> = {
  [TKey in keyof TRow]-?: TRow[TKey];
};

type CompleteDbTableValue<TValue> = TValue extends (infer TRow)[]
  ? TRow extends object
    ? CompleteDbRow<TRow>[]
    : TValue
  : TValue extends readonly (infer TRow)[]
    ? TRow extends object
      ? readonly CompleteDbRow<TRow>[]
      : TValue
    : TValue extends object
      ? CompleteDbRow<TValue>
      : TValue;

/**
 * Require every table key and every represented row column.
 *
 * This also makes optional `$inferInsert` columns explicit. A method that
 * intentionally does not own a generated column must exclude it from its
 * product-owned scheme first, for example `Omit<InsertRow, 'id'>`.
 */
type CompleteRestDbTableScheme<TTableScheme extends object> = {
  [TTableName in keyof TTableScheme]-?: CompleteDbTableValue<TTableScheme[TTableName]>;
};

/**
 * Pure, bidirectional conversion between one REST method type and the DB table
 * types participating in that method.
 *
 * Nullable/default DB columns remain required properties even when a Drizzle
 * `$inferInsert` type marks them optional. Nullability does not make a column
 * optional in the conversion contract.
 */
export interface RestDbMethodConverter<TMethodScheme, TTableScheme extends object> {
  toMethodScheme(tableScheme: Readonly<CompleteRestDbTableScheme<TTableScheme>>): TMethodScheme;
  toTableScheme(methodScheme: Readonly<TMethodScheme>): CompleteRestDbTableScheme<TTableScheme>;
}

/**
 * Define a product-specific REST ↔ DB converter with contextual return types.
 *
 * This is intentionally an identity function: conversion remains explicit,
 * synchronous, and free of hidden persistence or HTTP side effects.
 */
export function defineRestDbMethodConverter<TMethodScheme, TTableScheme extends object>(
  converter: RestDbMethodConverter<TMethodScheme, TTableScheme>,
): RestDbMethodConverter<TMethodScheme, TTableScheme> {
  return converter;
}
