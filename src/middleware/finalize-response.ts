import type { MiddlewareHandler } from 'hono';
import { etag } from 'hono/etag';

/**
 * Pre-built Hono ETag middleware in weak mode.
 *
 * @remarks
 * Reused across requests; it is stateless per invocation (all state lives on the passed `Context`).
 * @internal
 */
const applyWeakEtag = etag({ weak: true });

/**
 * Create a Hono middleware that adds a weak ETag to buffered responses.
 *
 * @remarks
 * ETag generation (and conditional `If-None-Match` → `304 Not Modified` handling) is delegated to
 * Hono's official `hono/etag` middleware in weak mode, so the ETag format is `W/"<sha1-hex>"`. This
 * no longer emulates the Express `etag` package byte-for-byte — the kit dropped NestJS/Express parity.
 *
 * Two categories of response are skipped so the downstream stream is never consumed:
 *
 * 1. **Server-Sent Events** (`text/event-stream`): the stream cannot be buffered to hash.
 * 2. **Bodyless responses** (e.g. `204`/`304`, or handlers returning `null`): nothing to hash.
 *
 * Responses that already carry an `ETag` header are left untouched by `hono/etag`.
 *
 * @returns A {@link MiddlewareHandler} that sets the `ETag` header (or short-circuits to `304` when
 * the request's `If-None-Match` matches).
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { finalizeResponse } from '@rdlabo/workers-hono-kit';
 *
 * const app = new Hono();
 * app.use('*', finalizeResponse());
 * app.get('/users', (c) => c.json({ ok: true }));
 * // → ETag: W/"<sha1-hex of the body>"
 * ```
 */
export function finalizeResponse(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    const contentType = c.res.headers.get('content-type') ?? '';
    // Leave SSE / streaming responses untouched, and skip bodyless responses (204/304/null).
    if (contentType.includes('text/event-stream') || !c.res.body) {
      return;
    }

    // The downstream handler already ran, so pass a no-op `next`; `hono/etag` then hashes the
    // buffered body and applies the ETag (or a conditional 304) to the existing response.
    await applyWeakEtag(c, async () => undefined);
  };
}
