import type { Context, Env } from 'hono';
import type { ErrorReporter, HttpErrorHandlerOptions, SentryExceptionReporterLike } from './http-error.js';
import { createSentryErrorReporter } from './http-error.js';
import type { QueryFailedClassifier } from './query-failed-error.js';
import { classifyGenericMysqlDriverError, createQueryFailedErrorHandler } from './query-failed-error.js';

/**
 * Options for {@link createAppErrorHandler}.
 *
 * @remarks
 * Wires `createQueryFailedErrorHandler` with fleet defaults ({@link classifyGenericMysqlDriverError}) and optional error reporting.
 * Pass `sentry` for Sentry-backed apps; omit it (or pass `undefined`) when not used.
 * `getReportError` / `reportError` override `sentry` (tests, container injection, scheduled paths).
 */
export interface CreateAppErrorHandlerOptions<E extends Env = Env> extends Omit<
  HttpErrorHandlerOptions<E>,
  'onUnhandledError'
> {
  /** mysql2 driver error classifier. Defaults to {@link classifyGenericMysqlDriverError}. */
  classify?: QueryFailedClassifier;
  /** Optional Sentry client (`@sentry/cloudflare`). Omitted on repos without Sentry. */
  sentry?: SentryExceptionReporterLike;
  /** Static reporter (tests, worker closure). Takes precedence over {@link sentry}. */
  reportError?: ErrorReporter;
  /** Read reporter from Hono context (e.g. `c.get('container')?.reportError`). Takes precedence over {@link sentry}. */
  getReportError?: (c: Context<E>) => ErrorReporter | undefined;
  /** Override auto-wired reporting (rare; prefer sentry / reportError / getReportError). */
  onUnhandledError?: (err: unknown, c: Context<E>) => void;
}

/**
 * Standard `app.onError` factory: QueryFailed filter → HTTP error handler, with optional error reporting.
 */
export function createAppErrorHandler<E extends Env = Env>(options: CreateAppErrorHandlerOptions<E> = {}) {
  const {
    classify = classifyGenericMysqlDriverError,
    sentry,
    reportError,
    getReportError,
    onUnhandledError,
    ...httpOptions
  } = options;

  const sentryReporter = sentry ? createSentryErrorReporter(sentry) : undefined;

  const resolvedOnUnhandled =
    onUnhandledError ??
    ((err: unknown, c: Context<E>) => {
      const reporter = getReportError?.(c) ?? reportError ?? sentryReporter;
      const requestId = (c.get as (key: string) => string | undefined)('requestId');
      reporter?.(err, { requestId });
    });

  return createQueryFailedErrorHandler<E>({
    ...httpOptions,
    classify,
    onUnhandledError: resolvedOnUnhandled,
  });
}
