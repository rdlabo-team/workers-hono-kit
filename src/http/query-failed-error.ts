import type { Context, Env } from 'hono';
import type { ErrorReporter, HttpErrorHandlerOptions } from './http-error.js';
import { createHttpErrorHandler } from './http-error.js';
import { findMysqlDriverError, logMysqlDriverError } from './mysql-driver-error.js';

/** DB エラー分類結果: `{ statusCode, message }` 形（error フィールド無し）。 */
export interface ClassifiedDbError {
  statusCode: 400 | 500;
  message: string;
}

/** mysql2 / Drizzle 由来の DB エラーを HTTP 応答用に分類する。非 DB エラーは null。 */
export type QueryFailedClassifier = (err: unknown) => ClassifiedDbError | null;

/**
 * Default classifier: any mysql2 driver error → generic 500 `{ statusCode, message: 'Internal server error' }`.
 */
export function classifyGenericMysqlDriverError(err: unknown): ClassifiedDbError | null {
  if (!findMysqlDriverError(err)) {
    return null;
  }
  return { statusCode: 500, message: 'Internal server error' };
}

/**
 * @internal Used by {@link createQueryFailedErrorHandler} only.
 */
function reportClassifiedDbError(
  err: unknown,
  classified: ClassifiedDbError,
  reportError?: ErrorReporter,
  requestId?: string,
): void {
  logMysqlDriverError(err, classified.statusCode);
  if (classified.statusCode === 500) {
    reportError?.(err, { requestId });
  }
}

export interface QueryFailedErrorHandlerOptions<E extends Env = Env> extends HttpErrorHandlerOptions<E> {
  /** アプリ固有の分類（日本語メッセージ等は consumer 側で定義）。 */
  classify: QueryFailedClassifier;
}

/**
 * DB エラー分類 → 標準 HTTP エラーハンドラの合成 onError。
 *
 * @remarks
 * classify が non-null のときは分類結果の body を返しつつログ（+ 500 は onUnhandledError）を残す。
 * 非 DB エラーは {@link createHttpErrorHandler} に委譲する。
 *
 * `Sentry.withSentry` だけでは onError 握りエラーは capture されないため、
 * `onUnhandledError: (err, c) => container.reportError?.(err, { requestId: c.get('requestId') })` を必ず配線する。
 */
export function createQueryFailedErrorHandler<E extends Env = Env>(options: QueryFailedErrorHandlerOptions<E>) {
  const { classify, ...httpOptions } = options;
  const httpErrorHandler = createHttpErrorHandler(httpOptions);
  const { onUnhandledError } = httpOptions;

  return (err: Error, c: Context<E>): Response => {
    const classified = classify(err);
    if (classified) {
      reportClassifiedDbError(err, classified);
      if (classified.statusCode === 500) {
        try {
          onUnhandledError?.(err, c);
        } catch {
          // Reporting must never change the error response.
        }
      }
      return c.json({ statusCode: classified.statusCode, message: classified.message }, classified.statusCode);
    }
    return httpErrorHandler(err, c);
  };
}
