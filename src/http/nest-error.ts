import type { Context, Env } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { findMysqlDriverError, logMysqlDriverError } from './mysql-driver-error.js';

/**
 * Reason phrases attached by the NestJS default exception filter, keyed by HTTP status code.
 *
 * @remarks
 * Mirrors the `error` field values NestJS produces for common client-error statuses, so a Hono app can
 * return byte-identical error bodies. Used as the default `reasonPhrases` map by {@link createNestErrorHandler}.
 */
export const NEST_REASON_PHRASES: Record<number, string> = {
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
 * Wire it into {@link createNestErrorHandler} via `onUnhandledError`, e.g.
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
   * the NestJS-shaped body.
   */
  body?: unknown;
}

/**
 * Options controlling how {@link createNestErrorHandler} shapes error responses.
 *
 * @typeParam E - The Hono environment type, so `onUnhandledError` receives a correctly typed context.
 */
export interface NestErrorHandlerOptions<E extends Env = Env> {
  /** Status-to-reason-phrase map for the `error` field. Defaults to {@link NEST_REASON_PHRASES}. */
  reasonPhrases?: Record<number, string>;
  /**
   * Statuses that return only `{ statusCode, message }`, omitting the `error` field. Defaults to `[401]`,
   * matching NestJS where a generic `HttpException(msg, 401)` carries no `error`.
   */
  bareStatuses?: readonly number[];
  /**
   * Field order of the non-bare error body. Defaults to `'statusCode-first'` (the NestJS canonical order).
   * Use `'message-first'` to emit `{ message, error, statusCode }` when byte parity requires it.
   */
  fieldOrder?: 'statusCode-first' | 'message-first';
  /**
   * Fallback `error` value for statuses that are neither bare nor present in `reasonPhrases`. Defaults to
   * `undefined`, meaning the `error` field is omitted when no reason phrase is known. Set to a string such
   * as `'Error'` to always include an `error` field, faithfully reproducing the NestJS default exception
   * filter behavior where `error` is always present.
   */
  fallbackReason?: string;
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
  /**
   * Response body for unexpected errors returned as 500. Defaults to
   * `{ statusCode: 500, message: 'Internal server error' }`.
   */
  internalServerErrorBody?: unknown;
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
 * Create a Hono `onError` handler that maps thrown errors to NestJS-shaped error JSON.
 *
 * @remarks
 * Reproduces the NestJS default exception filter so a Hono app returns byte-identical error bodies:
 * - HTTP errors (by default `HTTPException`) are mapped to a NestJS-shaped body; if the error carries a
 *   custom `body`, that body is returned verbatim.
 * - Statuses listed in `bareStatuses` (default `[401]`) omit the `error` field.
 * - Any other (unexpected) error triggers `onUnhandledError`, is logged via `console.error`, and returns 500.
 *
 * Per-app differences in body field order, HTTP error type, and reporting hook are absorbed through
 * {@link NestErrorHandlerOptions}, while the branching logic stays shared.
 *
 * @typeParam E - The Hono environment type propagated to `onUnhandledError`.
 * @param options - Overrides for reason phrases, bare statuses, field order, error detection, and reporting.
 * @returns A handler suitable for `app.onError(...)`.
 *
 * @example
 * ```ts
 * app.onError(
 *   createNestErrorHandler({
 *     fieldOrder: 'message-first',
 *     fallbackReason: 'Error',
 *     onUnhandledError: (err, c) => reportError(err, { requestId: c.get('requestId') }),
 *   }),
 * );
 * ```
 */
export function createNestErrorHandler<E extends Env = Env>(options: NestErrorHandlerOptions<E> = {}) {
  const {
    reasonPhrases = NEST_REASON_PHRASES,
    bareStatuses = [401],
    fieldOrder = 'statusCode-first',
    isHttpError = isHTTPException,
    onUnhandledError,
    internalServerErrorBody = { statusCode: 500, message: 'Internal server error' },
    fallbackReason,
  } = options;

  return (err: Error, c: Context<E>): Response => {
    if (isHttpError(err)) {
      // Escape hatch for a custom error body: render it verbatim.
      if (err.body !== undefined) {
        return c.json(err.body as object, err.status);
      }
      // reasonPhrases[status] is typed as string, but with noUncheckedIndexedAccess disabled it can be
      // undefined at runtime. The fallbackReason fallback for unregistered statuses is intentional.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const reason = bareStatuses.includes(err.status) ? undefined : (reasonPhrases[err.status] ?? fallbackReason);
      if (reason === undefined) {
        return c.json({ statusCode: err.status, message: err.message }, err.status);
      }
      const body =
        fieldOrder === 'message-first'
          ? { message: err.message, error: reason, statusCode: err.status }
          : { statusCode: err.status, message: err.message, error: reason };
      return c.json(body, err.status);
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
    return c.json(internalServerErrorBody as object, 500);
  };
}

/**
 * Hono `notFound` handler that returns the canonical Express/NestJS unmatched-route 404 body.
 *
 * @remarks
 * Produces `{ message: "Cannot <METHOD> <path>", error: 'Not Found', statusCode: 404 }`, matching the
 * NestJS default 404 response so unmatched routes stay byte-identical.
 *
 * @param c - The Hono request context for the unmatched route.
 * @returns A 404 JSON response.
 *
 * @example
 * ```ts
 * app.notFound(nestNotFoundHandler);
 * ```
 */
export function nestNotFoundHandler(c: Context): Response {
  return c.json(
    { message: `Cannot ${c.req.method} ${new URL(c.req.url).pathname}`, error: 'Not Found', statusCode: 404 },
    404,
  );
}
