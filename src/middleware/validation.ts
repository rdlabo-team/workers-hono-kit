import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import type { ZodType } from 'zod';

/**
 * Minimal structural shape that accepts either a zod v3 `ZodError` or a zod v4 core `$ZodError`.
 *
 * @remarks
 * Declaring only the `issues` array (with `path` and `message`) keeps the kit independent of a
 * specific zod major version while still exposing enough to format human-readable messages.
 */
export interface ZodErrorLike {
  /** The validation issues reported by zod, each with a property path and a message. */
  issues: readonly { path: PropertyKey[]; message: string }[];
}

/** Request part that a validator inspects, mirroring the targets supported by `@hono/zod-validator`. */
export type ValidationTarget = 'json' | 'query' | 'param' | 'header' | 'cookie' | 'form';

/** Options controlling the optional side effects of {@link validate}. */
export interface ValidateOptions {
  /**
   * Hook invoked when validation fails (e.g. to report to Sentry).
   *
   * @remarks
   * This never changes validation behavior — the response is always a NestJS `ValidationPipe`-shaped
   * 400. Exceptions thrown by the hook are swallowed. The default is a no-op (4xx errors are not
   * reported); pass a hook to forward failures to an error tracker.
   *
   * @param error - The zod error describing the failed validation.
   * @param c - The Hono context for the failing request.
   */
  onValidationError?: (error: ZodErrorLike, c: Context) => void;
}

/**
 * Convert a {@link ZodErrorLike} into NestJS `ValidationPipe`-style message strings.
 *
 * Each issue becomes `"<dotted.path>: <message>"`, or just `"<message>"` when the path is empty.
 *
 * @param error - The zod error to flatten.
 * @returns One message string per issue.
 */
function zodToMessages(error: ZodErrorLike): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Create a zod validation middleware that returns a NestJS `ValidationPipe`-shaped 400 on failure.
 *
 * On success the parsed value is made available through `@hono/zod-validator` as usual. On failure
 * the response body is `{ statusCode: 400, message: string[], error: 'Bad Request' }`, the failing
 * field paths are logged via `console.warn` (so 400s are visible in `wrangler dev`/Workers logs),
 * and {@link ValidateOptions.onValidationError} is invoked if provided.
 *
 * @remarks
 * The exact message strings differ from class-validator because they are produced by zod, but the
 * envelope shape matches NestJS so clients can parse failures identically.
 *
 * @typeParam T - The type produced by the zod schema.
 * @param target - The request part to validate.
 * @param schema - The zod schema to validate the target against.
 * @param options - Optional hooks; see {@link ValidateOptions}.
 * @returns A Hono middleware that validates `target` and short-circuits with a 400 on failure.
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { validate } from '@rdlabo/workers-hono-kit';
 *
 * app.post('/users', validate('json', z.object({ name: z.string() })), (c) => {
 *   const { name } = c.req.valid('json');
 *   return c.json({ name });
 * });
 * ```
 */
export function validate<T>(target: ValidationTarget, schema: ZodType<T>, options?: ValidateOptions) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const messages = zodToMessages(result.error);
      // Surface the failing fields in the runtime log. Without this the 400 is
      // invisible in `wrangler dev`/Workers logs (Sentry is the only sink, and
      // it is not visible locally), so a field-level type mismatch — e.g. a
      // string sent to `z.number()` — dies silently and is painful to diagnose.
      // Paths + zod messages only; no request values are logged.
      console.warn(`[validation] ${c.req.method} ${c.req.path} (${target}) → 400: ${messages.join('; ')}`);
      try {
        options?.onValidationError?.(result.error, c);
      } catch {
        // Reporting must never change validation error behavior.
      }
      return c.json({ statusCode: 400, message: messages, error: 'Bad Request' }, 400);
    }
    return undefined;
  });
}

/**
 * Minimal structural shape of a Sentry scope, covering only the methods this kit calls.
 *
 * @remarks
 * Declaring the shape structurally avoids a direct dependency on `@sentry/cloudflare`; any object
 * exposing these methods (such as the real Sentry scope) is accepted.
 */
export interface SentryScopeLike {
  /** Attach a string tag to the current scope. */
  setTag(key: string, value: string): void;
  /** Attach (or clear, with `null`) a structured context entry on the current scope. */
  setContext(key: string, context: Record<string, unknown> | null): void;
}

/**
 * Minimal structural shape of the Sentry client, covering only the methods this kit calls.
 *
 * @remarks
 * Like {@link SentryScopeLike}, this avoids a hard dependency on `@sentry/cloudflare`.
 */
export interface SentryLike {
  /** Run a callback with an isolated scope, restoring the previous scope afterward. */
  withScope(callback: (scope: SentryScopeLike) => void): void;
  /** Report an exception to Sentry. */
  captureException(error: unknown): void;
}

/**
 * Create a bound {@link validate} factory with optional Sentry reporting on validation failures.
 *
 * @param options.sentry - When set, 400 validation errors are reported (dto_validation tag + context).
 * @returns `(target, schema[, validateOptions])` middleware — same as {@link validate} when sentry is omitted.
 */
export function createValidate(options?: { sentry?: SentryLike }) {
  if (!options?.sentry) {
    return validate;
  }
  const sentry = options.sentry;
  const onValidationError = (error: ZodErrorLike): void => {
    const messages = zodToMessages(error);
    sentry.withScope((scope) => {
      scope.setTag('error.type', 'dto_validation');
      scope.setContext('validation', { errorCount: messages.length, errors: messages });
      sentry.captureException(error);
    });
  };
  return <T>(target: ValidationTarget, schema: ZodType<T>, validateOptions?: ValidateOptions) =>
    validate(target, schema, { ...validateOptions, onValidationError });
}

/**
 * @deprecated Use {@link createValidate}({ sentry }) instead.
 */
export function createSentryValidate(sentry: SentryLike) {
  return createValidate({ sentry });
}
