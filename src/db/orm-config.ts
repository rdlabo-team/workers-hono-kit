/**
 * Centralizes Drizzle column-name casing so it is fixed (standard: `snake_case`) in both the
 * config and the runtime ORM.
 *
 * @remarks
 * Casing is configured in two distinct places:
 *
 * 1. The top-level `casing` in `drizzle.config.ts` decides the column names that `db:generate`
 *    **creates** (see {@link honoDrizzleConfig}).
 * 2. The `drizzle(conn, { …casing })` call decides the column names the **runtime write builder**
 *    resolves to (see {@link DRIZZLE_ORM_OPTIONS}).
 *
 * If these two disagree, a multi-word camelCase column without an explicit column name will be
 * generated with one name but queried with another, producing a runtime `Unknown column` error —
 * something neither the type-check nor the migration surface, so it is caught late. Sourcing both
 * from here makes the mismatch structurally impossible. Casing is ignored for columns that declare
 * an explicit name, so this is a pure safety net that does not change existing behavior.
 *
 * The runtime `drizzle()` call itself is made by the consuming app with its own `drizzle-orm`; the
 * kit only ever provides values, never the ORM instance, to avoid splitting `drizzle-orm` into two
 * copies and breaking type identity.
 */

/**
 * Runtime ORM options shared by the consuming app's `drizzle()` call.
 *
 * Spread into the runtime ORM as `drizzle(conn, { schema, ...DRIZZLE_ORM_OPTIONS })` so the write
 * builder resolves column names as `snake_case`, matching what `db:generate` creates.
 *
 * @remarks
 * Fixes `mode: 'default'` and `casing: 'snake_case'`. See the module-level documentation for why
 * the same casing must be used by both the config and the runtime ORM.
 */
export const DRIZZLE_ORM_OPTIONS = { mode: 'default', casing: 'snake_case' } as const;

/**
 * Options for {@link honoDrizzleConfig}.
 */
export interface HonoDrizzleConfigOptions {
  /** drizzle-kit `dbCredentials.database` — the database name to connect to. */
  database: string;
  /** Database host; defaults to `process.env.DB_HOST` then `127.0.0.1`. */
  host?: string;
  /** Database port; defaults to `process.env.DB_PORT` then `3306`. */
  port?: number;
  /** Database user; defaults to `process.env.DB_USER` then `root`. */
  user?: string;
  /** Database password; defaults to `process.env.DB_PASSWORD` then `root`. */
  password?: string;
  /** Path to the schema directory; defaults to `'./src/db/schemes'`. */
  schema?: string;
  /** Output directory for generated migrations; defaults to `'./drizzle'`. */
  out?: string;
  /**
   * Optional table allow-list. Use this to restrict drizzle-kit to the schema's own tables when the
   * database is shared with another application.
   */
  tablesFilter?: string[];
  /**
   * Optional `db:introspect` (DB → JS) casing. This is an independent axis from the generation-side
   * `casing: 'snake_case'` and only affects introspection output.
   */
  introspect?: { casing: 'camel' | 'preserve' };
}

/**
 * Build a `drizzle.config.ts` configuration object with the kit's standard defaults.
 *
 * Fixes `casing: 'snake_case'`, the `schema`/`out` paths, and `dbCredentials` (with env-based
 * defaults), while leaving `tablesFilter` and `introspect` opt-in.
 *
 * @remarks
 * Returns a plain object rather than a typed drizzle-kit config so that `drizzle-kit` need not be a
 * dependency of the kit; the drizzle-kit CLI only reads the default export.
 *
 * @param options - configuration overrides; only `database` is required.
 * @returns a plain configuration object suitable for `export default` in `drizzle.config.ts`.
 * @example
 * ```ts
 * // drizzle.config.ts
 * import { honoDrizzleConfig } from '@rdlabo/workers-hono-kit/db';
 *
 * export default honoDrizzleConfig({ database: 'app' });
 * ```
 */
export function honoDrizzleConfig(options: HonoDrizzleConfigOptions) {
  const {
    database,
    host,
    port,
    user,
    password,
    schema = './src/db/schemes',
    out = './drizzle',
    tablesFilter,
    introspect,
  } = options;
  // CI/production migrate absorbs the pattern of passing a whole AWS Secrets Manager RDS managed secret
  // (keys host/port/dbname/username/password) via `DB_SECRET`. It is parsed with JSON.parse, so key-name
  // differences (host ≠ DB_HOST) can be mapped and special characters in the password stay shell-safe.
  // When `DB_SECRET` is set, it is treated as a complete secret and fully determines the connection
  // (missing/invalid → throw). Only when it is unset do we fall back to the individual DB_* env vars
  // and then the defaults (the local / db:generate path).
  const secret = resolveDbSecret();
  const dbCredentials = secret
    ? {
        host: secret.host,
        port: secret.port,
        user: secret.username,
        password: secret.password,
        database: secret.dbname,
      }
    : {
        host: host ?? process.env.DB_HOST ?? '127.0.0.1',
        port: port ?? Number(process.env.DB_PORT ?? 3306),
        user: user ?? process.env.DB_USER ?? 'root',
        password: password ?? process.env.DB_PASSWORD ?? 'root',
        database,
      };
  return {
    dialect: 'mysql' as const,
    schema,
    out,
    casing: 'snake_case' as const,
    ...(tablesFilter ? { tablesFilter } : {}),
    ...(introspect ? { introspect } : {}),
    dbCredentials,
  };
}

/** The return value of {@link resolveDbSecret} (normalized connection info). */
export interface ResolvedDbSecret {
  host: string;
  port: number;
  dbname: string;
  username: string;
  password: string;
}

/**
 * Resolve an AWS RDS managed secret (a JSON string placed in `DB_SECRET`).
 *
 * @remarks
 * - `DB_SECRET` unset → `undefined` (the normal local / `db:generate` fallback).
 * - When set, it must be complete connection info: **invalid JSON / a missing required key throws**
 *   (rather than silently falling back to localhost and causing an incident). A missing `port` alone
 *   defaults to 3306.
 *
 * Both `honoDrizzleConfig` (db:migrate) and the `workers-hono-kit-db-baseline` bin use this same logic.
 *
 * @returns the resolved connection info, or `undefined` when `DB_SECRET` is unset.
 * @throws Error when `DB_SECRET` is set but is not valid JSON or is missing a required key.
 */
export function resolveDbSecret(): ResolvedDbSecret | undefined {
  const raw = process.env.DB_SECRET;
  if (!raw) {
    return undefined;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('DB_SECRET is set but is not valid JSON (expected an AWS RDS managed secret string).');
  }
  const { host, dbname, username, password } = parsed;
  if (
    typeof host !== 'string' ||
    typeof dbname !== 'string' ||
    typeof username !== 'string' ||
    typeof password !== 'string'
  ) {
    throw new Error('DB_SECRET must contain string host, dbname, username, password (AWS RDS managed secret shape).');
  }
  return { host, dbname, username, password, port: parsed.port === undefined ? 3306 : Number(parsed.port) };
}
