/**
 * A product-owned table bundle used by one REST API method.
 *
 * Each property represents one DB table participating in the method. Products
 * should use their exported Drizzle `$inferSelect` / `$inferInsert` types here;
 * this package deliberately knows no table names or columns.
 */
export type RestDbTableScheme = object;

/**
 * Pure, bidirectional conversion between one REST method type and the DB table
 * types participating in that method.
 *
 * Nullable DB columns remain required properties when their Drizzle type is
 * `T | null`: nullability does not make the property optional. Consequently,
 * an omitted column is caught by TypeScript in `toTableScheme`.
 */
export interface RestDbMethodConverter<TMethodScheme, TTableScheme extends RestDbTableScheme> {
  toMethodScheme(tableScheme: Readonly<TTableScheme>): TMethodScheme;
  toTableScheme(methodScheme: Readonly<TMethodScheme>): TTableScheme;
}

/**
 * Define a product-specific REST ↔ DB converter with contextual return types.
 *
 * This is intentionally an identity function: conversion remains explicit,
 * synchronous, and free of hidden persistence or HTTP side effects.
 */
export function defineRestDbMethodConverter<TMethodScheme, TTableScheme extends RestDbTableScheme>(
  converter: RestDbMethodConverter<TMethodScheme, TTableScheme>,
): RestDbMethodConverter<TMethodScheme, TTableScheme> {
  return converter;
}
