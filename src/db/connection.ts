import { createConnection } from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';
import type { ExecutionContextLike } from '../http/execution-context.js';
import { MYSQL_TIMEZONE } from './jst.js';

export type { ExecutionContextLike } from '../http/execution-context.js';

/**
 * Minimal structural shape of a Cloudflare Hyperdrive binding.
 *
 * @remarks
 * Declared structurally to avoid a dependency on `@cloudflare/workers-types`; any object with these
 * connection fields satisfies it.
 */
export interface HyperdriveLike {
  /** Database host to connect to. */
  host: string;
  /** Database user. */
  user: string;
  /** Database password. */
  password: string;
  /** Database name. */
  database: string;
  /** Database port. */
  port: number;
}

/**
 * Build mysql2 `createConnection` options from a Hyperdrive binding, applying the kit's defaults.
 *
 * @remarks
 * Three defaults are applied and can each be overridden via `extra`:
 *
 * - `disableEval: true` — `eval` is unavailable in the Workers runtime, so the driver's eval-based
 *   fast paths must be disabled.
 * - `decimalNumbers: true` — return `DECIMAL`/`NEWDECIMAL` columns as JS `number` rather than
 *   strings, so raw-SQL reads and Drizzle's inferred types align on a single numeric domain type.
 *   This assumes no column's precision exceeds the JS safe-integer range.
 * - `timezone: '+09:00'` — set the driver's session timezone to JST. mysql2 defaults to `'local'`,
 *   which is UTC in the Workers runtime; pinning the driver timezone keeps `datetime`/`timestamp`
 *   round-trips independent of the database's session timezone (only the internally stored UTC
 *   value differs, which is invisible to the application). Non-JST deployments can override this
 *   via `extra: { timezone: '...' }`.
 *
 * @param hyperdrive - the Hyperdrive binding to derive connection fields from.
 * @param extra - additional mysql2 options merged last, overriding the defaults above.
 * @returns a plain options object to pass to mysql2 `createConnection`.
 */
export function hyperdriveConnectionOptions(
  hyperdrive: HyperdriveLike,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    host: hyperdrive.host,
    user: hyperdrive.user,
    password: hyperdrive.password,
    database: hyperdrive.database,
    port: hyperdrive.port,
    disableEval: true,
    decimalNumbers: true,
    timezone: MYSQL_TIMEZONE,
    ...extra,
  };
}

/**
 * Open primary and replica connections, run `fn` with them, and close both afterwards.
 *
 * The connections are always closed in a `finally` block; closing is scheduled through
 * `ctx.waitUntil` so it can complete after the response has been returned, without blocking it.
 *
 * @typeParam T - resolved value produced by `fn`.
 * @param hyperdrives - the primary and replica Hyperdrive bindings to connect to.
 * @param ctx - the execution context whose `waitUntil` defers connection teardown past the response.
 * @param fn - callback invoked with the open `primary` and `replica` connections.
 * @param connectionOptions - extra mysql2 options forwarded to {@link hyperdriveConnectionOptions}.
 * @returns the value resolved by `fn`.
 * @example
 * ```ts
 * const data = await withMysqlConnections(
 *   { primary: env.PRIMARY, replica: env.REPLICA },
 *   ctx,
 *   async ({ primary, replica }) => {
 *     const [rows] = await replica.query('SELECT 1');
 *     return rows;
 *   },
 * );
 * ```
 */
export async function withMysqlConnections<T>(
  hyperdrives: { primary: HyperdriveLike; replica: HyperdriveLike },
  ctx: ExecutionContextLike,
  fn: (connections: { primary: Connection; replica: Connection }) => Promise<T>,
  connectionOptions?: Record<string, unknown>,
): Promise<T> {
  let primary: Connection | undefined;
  let replica: Connection | undefined;
  try {
    primary = await createConnection(hyperdriveConnectionOptions(hyperdrives.primary, connectionOptions));
    replica = await createConnection(hyperdriveConnectionOptions(hyperdrives.replica, connectionOptions));
    return await fn({ primary, replica });
  } finally {
    const closing = [primary, replica].filter((c): c is Connection => c !== undefined).map((c) => c.end());
    if (closing.length > 0) {
      ctx.waitUntil(Promise.allSettled(closing));
    }
  }
}
