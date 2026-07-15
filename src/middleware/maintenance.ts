import type { Context, Env, MiddlewareHandler } from 'hono';

/** Canonical API error `code` for fleet-wide maintenance short-circuit. */
export const MAINTENANCE_CODE = 'MAINTENANCE' as const;

/** Default allowlisted SSE path that stays open while the rest of the API returns 503. */
export const MAINTENANCE_WAIT_PATH = '/public/maintenance/wait';

/** JSON body returned for every blocked request during maintenance. */
export interface MaintenanceBody {
  statusCode: 503;
  message: string;
  code: typeof MAINTENANCE_CODE;
}

/** Default 503 body (no phrase `error` field — would collide with `code` shape on the client). */
export const MAINTENANCE_BODY: MaintenanceBody = {
  statusCode: 503,
  message: 'Service temporarily unavailable',
  code: MAINTENANCE_CODE,
};

/**
 * True when the Workers binding / wrangler var `MAINTENANCE` is the string `'1'`.
 *
 * @param env - Bindings object that may carry `MAINTENANCE`
 */
export function isMaintenanceEnabled(env: { MAINTENANCE?: string } | null | undefined): boolean {
  return env?.MAINTENANCE === '1';
}

/**
 * Options for {@link createMaintenanceMiddleware}.
 *
 * @typeParam E - The Hono `Env` of the application.
 */
export interface MaintenanceMiddlewareOptions<E extends Env = Env> {
  /**
   * Whether maintenance mode is currently on for this request.
   *
   * @remarks
   * Typical wiring: `(c) => isMaintenanceEnabled(c.env)`. Injected so tests and non-env sources
   * (future KV) can supply their own predicate without forking the middleware.
   */
  isEnabled: (c: Context<E>) => boolean;
  /**
   * Paths that stay reachable during maintenance (default: {@link MAINTENANCE_WAIT_PATH}).
   *
   * @remarks
   * Compared against `pathname` with and without a trailing slash. {@link MAINTENANCE_WAIT_PATH}
   * is handled inside this middleware (SSE) so it never reaches container/DB. Other allowlisted
   * paths call `next()`.
   */
  allowPaths?: readonly string[];
  /** Override the default {@link MAINTENANCE_BODY.message}. */
  message?: string;
  /** Optional `Retry-After` header (seconds). */
  retryAfterSeconds?: number;
  /**
   * Ping interval for the in-middleware wait SSE (ms). Defaults to `5_000`.
   *
   * @see {@link MaintenanceWaitOptions.pingIntervalMs}
   */
  pingIntervalMs?: number;
}

/**
 * Options for {@link createMaintenanceWaitHandler}.
 *
 * @typeParam E - The Hono `Env` of the application.
 */
export interface MaintenanceWaitOptions<E extends Env = Env> {
  /**
   * Whether maintenance mode is still on. Re-evaluated on each ping tick.
   *
   * @remarks
   * Wrangler `vars` do not change inside a long-lived isolate; after a deploy that clears
   * `MAINTENANCE`, new connections (and clients that reconnect) see `false` and get `ended`.
   */
  isEnabled: (c: Context<E>) => boolean;
  /**
   * Interval between SSE `ping` events and `isEnabled` re-checks (ms). Defaults to `5_000`.
   */
  pingIntervalMs?: number;
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function isAllowlisted(pathname: string, allowPaths: ReadonlySet<string>): boolean {
  const normalized = normalizePath(pathname);
  return allowPaths.has(normalized) || allowPaths.has(pathname);
}

/**
 * Short-circuit middleware: when enabled, every non-allowlisted request returns
 * `503` + `{ statusCode, message, code: 'MAINTENANCE' }` without running downstream
 * (so container / Hyperdrive / secrets stay cold).
 *
 * @remarks
 * Mount **after** `cors` / `finalizeResponse` and **before** `containerMiddleware`.
 * {@link MAINTENANCE_WAIT_PATH} is served **inside this middleware** (both when
 * maintenance is on and off) so the wait SSE never reaches container / DB. Other
 * `allowPaths` still call `next()`.
 *
 * @typeParam E - The Hono `Env` of the application.
 * @param options - Enable predicate, allowlist, and optional body/header overrides.
 * @returns A {@link MiddlewareHandler} that either returns 503 / SSE or calls `next()`.
 *
 * @example
 * ```ts
 * app.use('*', createMaintenanceMiddleware({
 *   isEnabled: (c) => isMaintenanceEnabled(c.env),
 * }));
 * // Optional: also register createMaintenanceWaitHandler as a route — redundant when
 * // this middleware is mounted, because MAINTENANCE_WAIT_PATH is handled here.
 * ```
 */
export function createMaintenanceMiddleware<E extends Env = Env>(
  options: MaintenanceMiddlewareOptions<E>,
): MiddlewareHandler<E> {
  const allowPaths = new Set(
    (options.allowPaths ?? [MAINTENANCE_WAIT_PATH]).map((p) => normalizePath(p)),
  );
  const message = options.message ?? MAINTENANCE_BODY.message;
  const waitHandler = createMaintenanceWaitHandler({
    isEnabled: options.isEnabled,
    pingIntervalMs: options.pingIntervalMs,
  });
  const waitPath = normalizePath(MAINTENANCE_WAIT_PATH);

  return async (c, next) => {
    const pathname = normalizePath(new URL(c.req.url).pathname);

    // Wait SSE must never hit container/DB — handle it here whether maintenance is on or off.
    if (pathname === waitPath) {
      return waitHandler(c);
    }

    if (!options.isEnabled(c)) {
      return next();
    }
    if (isAllowlisted(pathname, allowPaths)) {
      return next();
    }
    if (options.retryAfterSeconds != null) {
      c.header('Retry-After', String(options.retryAfterSeconds));
    }
    const body: MaintenanceBody = {
      statusCode: 503,
      message,
      code: MAINTENANCE_CODE,
    };
    return c.json(body, 503);
  };
}

/**
 * SSE handler for {@link MAINTENANCE_WAIT_PATH}.
 *
 * @remarks
 * - Already off → emit `event: ended` once and close.
 * - Still on → emit `event: ping` on an interval; when `isEnabled` becomes false, emit
 *   `event: ended` and close. Clients should close the EventSource on `ended` and dismiss UI.
 *
 * @typeParam E - The Hono `Env` of the application.
 * @param options - Enable predicate and ping interval.
 * @returns A handler `(c) => Response` suitable for `app.get(MAINTENANCE_WAIT_PATH, …)`
 *   or for embedding inside {@link createMaintenanceMiddleware}.
 */
export function createMaintenanceWaitHandler<E extends Env = Env>(
  options: MaintenanceWaitOptions<E>,
): (c: Context<E>) => Response {
  const pingIntervalMs = options.pingIntervalMs ?? 5_000;
  const encoder = new TextEncoder();

  return (c) => {
    const clientSignal = c.req.raw.signal;

    if (!options.isEnabled(c)) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: ended\ndata: ended\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { headers: SSE_HEADERS });
    }

    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;

        const close = () => {
          if (closed) {
            return;
          }
          closed = true;
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = undefined;
          }
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        const enqueue = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            close();
          }
        };

        const end = () => {
          enqueue('event: ended\ndata: ended\n\n');
          close();
        };

        if (clientSignal.aborted) {
          close();
          return;
        }
        clientSignal.addEventListener('abort', close, { once: true });

        heartbeat = setInterval(() => {
          if (!options.isEnabled(c)) {
            end();
            return;
          }
          enqueue('event: ping\ndata: ping\n\n');
        }, pingIntervalMs);
      },
      cancel() {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  };
}
