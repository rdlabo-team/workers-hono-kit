// @rdlabo/workers-hono-kit/db — mysql2 依存のデータ層ヘルパ（ルート `.` は web 標準のみのため別サブパス）。
// drizzle-orm の型同一性には依存しない（orm は消費側が渡す）。

export { retryWhenDeadlock } from './retry';

export { createMysqlDatabase, createHyperdriveDatabase, databaseFrom } from './database';
export type {
  Database,
  DisposableDatabase,
  QueryRunner,
  TxOf,
  CreateMysqlDatabaseOptions,
  CreateHyperdriveDatabaseOptions,
  Connection,
  Pool,
} from './database';

export { insertIdOf, affectedRowsOf, insertedIdsOf } from './write-result';
export type { DzWriteResult } from './write-result';

export { hyperdriveConnectionOptions, withMysqlConnections } from './connection';
export type { HyperdriveLike, ExecutionContextLike } from './connection';

export { toJstDate, jstTimestampParams, jstDatetimeParams, jstDateParams } from './jst';

export { DRIZZLE_ORM_OPTIONS, honoDrizzleConfig } from './orm-config';
export type { HonoDrizzleConfigOptions } from './orm-config';
