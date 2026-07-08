import type { Context, Env } from 'hono';
import {
  classifyGenericMysqlDriverError,
  createQueryFailedNestErrorHandler,
  type QueryFailedClassifier,
} from './query-failed-error.js';
import type { ErrorReporter, NestErrorHandlerOptions, SentryExceptionReporterLike } from './nest-error.js';
import { createSentryErrorReporter } from './nest-error.js';

/**
 * Options for {@link createAppErrorHandler}.
 *
 * @remarks
 * Wires `createQueryFailedNestErrorHandler` with fleet defaults (`fieldOrder: 'message-first'`,
 * {@link classifyGenericMysqlDriverError}) and optional error reporting.
 * Pass `sentry` for Sentry-backed apps; omit it (or pass `undefined`) when not used.
 * `getReportError` / `reportError` override `sentry` (tests, container injection, scheduled paths).
 */
export interface CreateAppErrorHandlerOptions<E extends Env = Env>
  extends Omit<NestErrorHandlerOptions<E>, 'onUnhandledError'> {
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
 * Standard `app.onError` factory: QueryFailed filter → Nest default filter, with optional error reporting.
 */
export function createAppErrorHandler<E extends Env = Env>(options: CreateAppErrorHandlerOptions<E> = {}) {
  const {
    classify = classifyGenericMysqlDriverError,
    sentry,
    reportError,
    getReportError,
    onUnhandledError,
    fieldOrder = 'message-first',
    ...nestOptions
  } = options;

  const sentryReporter = sentry ? createSentryErrorReporter(sentry) : undefined;

  const resolvedOnUnhandled =
    onUnhandledError ??
    ((err: unknown, c: Context<E>) => {
      const reporter = getReportError?.(c) ?? reportError ?? sentryReporter;
      const requestId = (c.get as (key: string) => string | undefined)('requestId');
      reporter?.(err, { requestId });
    });

  return createQueryFailedNestErrorHandler<E>({
    fieldOrder,
    ...nestOptions,
    classify,
    onUnhandledError: resolvedOnUnhandled,
  });
}
