import type { Context, Env } from 'hono';
import { findMysqlDriverError, logMysqlDriverError } from './mysql-driver-error.js';
import { createNestErrorHandler } from './nest-error.js';
import type { ErrorReporter, NestErrorHandlerOptions } from './nest-error.js';

/** Nest QueryFailedExceptionFilter が返す `{ statusCode, message }` 形（error フィールド無し）。 */
export interface ClassifiedDbError {
  statusCode: 400 | 500;
  message: string;
}

/** mysql2 / Drizzle 由来の DB エラーを HTTP 応答用に分類する。非 DB エラーは null。 */
export type QueryFailedClassifier = (err: unknown) => ClassifiedDbError | null;

/**
 * Default classifier for apps without a NestJS `QueryFailedExceptionFilter` parity layer.
 * Maps any mysql2 driver error to generic 500 `{ statusCode, message: 'Internal server error' }`.
 */
export function classifyGenericMysqlDriverError(err: unknown): ClassifiedDbError | null {
  if (!findMysqlDriverError(err)) {
    return null;
  }
  return { statusCode: 500, message: 'Internal server error' };
}

/**
 * @internal Used by {@link createQueryFailedNestErrorHandler} only.
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

export interface QueryFailedNestErrorHandlerOptions<E extends Env = Env> extends NestErrorHandlerOptions<E> {
  /** アプリ固有の分類（parity-critical な日本語メッセージ等は consumer 側で定義）。 */
  classify: QueryFailedClassifier;
}

/**
 * QueryFailedExceptionFilter → Nest 既定 exception filter の合成 onError。
 *
 * @remarks
 * classify が non-null のときは parity 用 body を返しつつログ（+ 500 は onUnhandledError）を残す。
 * 非 DB エラーは {@link createNestErrorHandler} に委譲する。
 *
 * `Sentry.withSentry` だけでは onError 握りエラーは capture されないため、
 * `onUnhandledError: (err, c) => container.reportError?.(err, { requestId: c.get('requestId') })` を必ず配線する。
 */
export function createQueryFailedNestErrorHandler<E extends Env = Env>(options: QueryFailedNestErrorHandlerOptions<E>) {
  const { classify, ...nestOptions } = options;
  const nestErrorHandler = createNestErrorHandler(nestOptions);
  const { onUnhandledError } = nestOptions;

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
    return nestErrorHandler(err, c);
  };
}
