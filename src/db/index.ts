/**
 * Data-layer helpers that depend on `mysql2` (exposed under the `/db` subpath because the package
 * root is reserved for web-standard-only code).
 *
 * @remarks
 * This module never depends on the type identity of `drizzle-orm`: the ORM instance is always
 * supplied by the consumer. That keeps the kit safe to use even when the kit and the consuming app
 * resolve separate copies of `drizzle-orm`.
 *
 * @packageDocumentation
 */

export { retryWhenDeadlock } from './retry.js';

export { createMysqlDatabase, createHyperdriveDatabase, databaseFrom } from './database.js';
export type {
  Database,
  DisposableDatabase,
  QueryRunner,
  TxOf,
  CreateMysqlDatabaseOptions,
  CreateHyperdriveDatabaseOptions,
  Connection,
  Pool,
} from './database.js';

export { insertIdOf, affectedRowsOf, insertedIdsOf } from './write-result.js';
export type { DzWriteResult } from './write-result.js';

export { hyperdriveConnectionOptions, withMysqlConnections } from './connection.js';
export type { HyperdriveLike, ExecutionContextLike } from './connection.js';

/* eslint-disable @typescript-eslint/no-deprecated -- db barrel intentionally re-exports deprecated JST shims */
export {
  MYSQL_TIMEZONE,
  toMysqlDateTime,
  DEFAULT_TZ_OFFSET_MINUTES,
  parseTzOffsetMinutes,
  toTzWallClock,
  toJstWallClock,
  formatJstDate,
  ageInTz,
  ageInJst,
  tzDateString,
  jstDateString,
  tzBoundaryAsUtc,
  jstBoundaryAsUtc,
  toJstDate,
  jstTimestampParams,
  jstDatetimeParams,
  jstDateParams,
} from './jst.js';
/* eslint-enable @typescript-eslint/no-deprecated */
export type { FormatJstDateOptions } from './jst.js';

export { coerceDecimalNumber, decimalNumberParams } from './decimal.js';
export type { DecimalNumberConfig } from './decimal.js';

export { jstTimestamp, jstDatetime, jstDate, decimalNumber, jstOnUpdateNow } from './columns.js';

export { DRIZZLE_ORM_OPTIONS, honoDrizzleConfig, resolveDbSecret } from './orm-config.js';
export type { HonoDrizzleConfigOptions, ResolvedDbSecret } from './orm-config.js';

export { baselineMigrations, readBaselineEntry } from './migrate.js';
export type { BaselineMigrationsOptions, BaselineResult, BaselineEntry } from './migrate.js';
