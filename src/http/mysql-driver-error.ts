/**
 * mysql2 driver error shape (= TypeORM QueryFailedError.driverError 相当).
 * Drizzle / Error.cause で wrap される場合があるため cause も再帰探索する。
 */
export interface MysqlDriverErrorLike {
  errno?: number;
  sqlMessage?: string;
  sqlState?: string;
  message?: string;
  sql?: string;
  code?: string;
  cause?: unknown;
}

/**
 * err 本体 → `err.cause` を再帰的に辿り、mysql2 ドライバエラーを取り出す。
 *
 * @param err - handler / onError に渡された thrown value。
 * @param seen - 循環参照防止（内部用）。
 */
export function findMysqlDriverError(err: unknown, seen = new Set<unknown>()): MysqlDriverErrorLike | null {
  if (err === null || err === undefined || seen.has(err)) {
    return null;
  }
  seen.add(err);
  const e = err as MysqlDriverErrorLike;
  if (typeof e.errno === 'number' && (typeof e.sqlMessage === 'string' || typeof e.sqlState === 'string')) {
    return e;
  }
  if (e.cause !== undefined) {
    return findMysqlDriverError(e.cause, seen);
  }
  return null;
}

/**
 * Nest QueryFailedExceptionFilter の logger.error / logger.warn 相当。
 * レスポンス body には載せず、Workers Logs 用に errno / sqlMessage / sql を残す。
 */
export function logMysqlDriverError(err: unknown, statusCode: number): void {
  const driver = findMysqlDriverError(err);
  const rawMessage = driver?.sqlMessage ?? driver?.message ?? (err instanceof Error ? err.message : String(err));
  const detail = driver === null ? undefined : { errno: driver.errno, sql: driver.sql, code: driver.code };
  const line = `QueryFailedError (${statusCode}): ${rawMessage}`;

  if (statusCode >= 500) {
    console.error(line, detail);
    return;
  }
  console.warn(line, detail);
}
