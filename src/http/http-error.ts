import type { Context, Env } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { findMysqlDriverError, logMysqlDriverError } from './mysql-driver-error.js';

/** Statuses that return only `{ statusCode, message }` (no `error` field). */
const BARE_STATUSES = [401] as const;

const INTERNAL_SERVER_ERROR_BODY = { statusCode: 500, message: 'Internal server error' } as const;

/**
 * Standard `error` field phrases for common HTTP status codes.
 *
 * @remarks
 * Used by {@link createHttpErrorHandler} for the `error` field on client-error statuses.
 */
export const HTTP_ERROR_PHRASES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
};

/**
 * Contextual metadata passed to an {@link ErrorReporter} when reporting an unexpected error.
 */
export interface ErrorReportContext {
  /** Correlation id for the failing request, if one is tracked. */
  requestId?: string;
}

/**
 * Signature of a function that reports an unexpected (non-HTTP) error to an external sink such as Sentry.
 *
 * @remarks
 * Wire it into {@link createHttpErrorHandler} via `onUnhandledError`, e.g.
 * `(err, c) => reporter(err, { requestId: c.get('requestId') })`. The reporting client itself is
 * intentionally kept out of this kit; the consumer supplies the implementation.
 *
 * @param error - The thrown value being reported.
 * @param context - Optional correlation context for the failing request.
 */
export type ErrorReporter = (error: unknown, context?: ErrorReportContext) => void;

/**
 * Minimal Sentry-like client for {@link createSentryErrorReporter} and {@link createQueueErrorHandler}.
 *
 * @remarks
 * Declared structurally to avoid a hard dependency on `@sentry/cloudflare`.
 */
export interface SentryExceptionReporterLike {
  captureException(
    exception: unknown,
    captureContext?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
  ): void;
}

/**
 * Build an {@link ErrorReporter} that forwards unhandled errors to Sentry with an optional `request_id` tag.
 */
export function createSentryErrorReporter(sentry: SentryExceptionReporterLike): ErrorReporter {
  return (error, context) => {
    sentry.captureException(error, context?.requestId ? { tags: { request_id: context.requestId } } : undefined);
  };
}

/**
 * Minimal shape read from a value treated as an HTTP error: its status, message, and optional body.
 *
 * @internal
 */
interface HttpErrorLike {
  /** HTTP status code to respond with. */
  status: ContentfulStatusCode;
  /** Human-readable error message placed in the response body. */
  message: string;
  /**
   * Escape hatch for a fully custom response body. When present, it is rendered verbatim instead of
   * the standard error JSON shape.
   */
  body?: unknown;
}

/**
 * Options controlling how {@link createHttpErrorHandler} shapes error responses.
 *
 * @typeParam E - The Hono environment type, so `onUnhandledError` receives a correctly typed context.
 */
export interface HttpErrorHandlerOptions<E extends Env = Env> {
  /**
   * Predicate identifying which thrown values are HTTP errors. Defaults to detecting Hono's `HTTPException`.
   * Override it (e.g. `(e) => e instanceof MyHttpError`) when the app throws a custom HTTP error type.
   */
  isHttpError?: (err: unknown) => err is HttpErrorLike;
  /**
   * Hook invoked before an unexpected (non-HTTP) error is returned as a 500, typically used to report the
   * error (e.g. to Sentry). Any exception thrown by this hook is swallowed so reporting cannot alter the
   * error response.
   */
  onUnhandledError?: (err: unknown, c: Context<E>) => void;
}

/**
 * Structurally detect Hono's `HTTPException` without relying on `instanceof`.
 *
 * @remarks
 * When this kit is symlinked into a consumer, the `hono` instance it resolves can differ from the
 * consumer's `hono`, so an `HTTPException` from one copy fails an `instanceof` check against the other.
 * Detecting the presence of a `getResponse()` method and a numeric `status` is stable across module
 * boundaries and production bundles.
 *
 * @param err - The thrown value to test.
 * @returns `true` when `err` looks like a Hono `HTTPException`.
 *
 * @internal
 */
const isHTTPException = (err: unknown): err is HttpErrorLike =>
  err instanceof Error &&
  typeof (err as { getResponse?: unknown }).getResponse === 'function' &&
  typeof (err as { status?: unknown }).status === 'number';

/**
 * Create a Hono `onError` handler that maps thrown errors to standard API error JSON.
 *
 * @remarks
 * - HTTP errors (by default `HTTPException`) map to `{ statusCode, message, error? }`; `401` omits `error`.
 * - Errors with a custom `body` are returned verbatim.
 * - Unexpected errors trigger `onUnhandledError`, are logged, and return generic 500.
 *
 * @typeParam E - The Hono environment type propagated to `onUnhandledError`.
 * @param options - Optional custom HTTP error detection and reporting hook.
 * @returns A handler suitable for `app.onError(...)`.
 *
 * @example
 * ```ts
 * app.onError(
 *   createHttpErrorHandler({
 *     onUnhandledError: (err, c) => reportError(err, { requestId: c.get('requestId') }),
 *   }),
 * );
 * ```
 */
export function createHttpErrorHandler<E extends Env = Env>(options: HttpErrorHandlerOptions<E> = {}) {
  const { isHttpError = isHTTPException, onUnhandledError } = options;

  return (err: Error, c: Context<E>): Response => {
    if (isHttpError(err)) {
      if (err.body !== undefined) {
        return c.json(err.body as object, err.status);
      }
      const reason = (BARE_STATUSES as readonly number[]).includes(err.status)
        ? undefined
        : HTTP_ERROR_PHRASES[err.status];
      if (reason === undefined) {
        return c.json({ statusCode: err.status, message: err.message }, err.status);
      }
      return c.json({ statusCode: err.status, message: err.message, error: reason }, err.status);
    }

    try {
      onUnhandledError?.(err, c);
    } catch {
      // Reporting must never change the behavior of the error response.
    }
    if (findMysqlDriverError(err)) {
      logMysqlDriverError(err, 500);
    } else {
      console.error(err);
    }
    return c.json(INTERNAL_SERVER_ERROR_BODY, 500);
  };
}

/**
 * Hono `notFound` handler for unmatched routes.
 *
 * @param c - The Hono request context for the unmatched route.
 * @returns A 404 JSON response: `{ message: 'Cannot METHOD path', error, statusCode }`.
 *
 * @example
 * ```ts
 * app.notFound(notFoundHandler);
 * ```
 */
export function notFoundHandler(c: Context): Response {
  return c.json(
    { message: `Cannot ${c.req.method} ${new URL(c.req.url).pathname}`, error: 'Not Found', statusCode: 404 },
    404,
  );
}
