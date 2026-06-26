/**
 * Drizzle の列名 casing をフリートで一元管理する（標準: snake_case を「config」と「runtime」の両方で固定）。
 *
 * casing は2か所にあり別物:
 *   ① drizzle.config.ts の top-level `casing` … `db:generate` が **作る列名** を決める（→ honoDrizzleConfig）
 *   ② database.ts の `drizzle(conn, { …casing })` … **実行時の書き込みビルダが参照する列名** を決める（→ DRIZZLE_ORM_OPTIONS）
 *
 * この2つが食い違うと、明示列名を書き忘れた camelCase 複数単語列で generate と実行時がズレて実行時
 * `Unknown column` になる（typecheck もマイグレーションも正常に見えるので発覚が遅い）。両方ここから取れば
 * ズレが構造的に起きない。明示列名がある列では casing は無視されるので、既存挙動は変えない純粋な安全網。
 *
 * 注: runtime の `drizzle()` 呼び出し自体は **消費側 repo が自分の drizzle-orm で行う**（kit が drizzle() を
 * 呼ぶと kit と repo で drizzle-orm が別コピーになり型同一性が壊れるため）。kit は「値」だけを提供する。
 */

/**
 * runtime 用。消費側 repo の database.ts で `drizzle(conn, { schema, ...DRIZZLE_ORM_OPTIONS })` と spread して使う。
 * mode/casing を kit が固定し、書き込みビルダの列名解決を snake_case に揃える。
 */
export const DRIZZLE_ORM_OPTIONS = { mode: 'default', casing: 'snake_case' } as const;

export interface HonoDrizzleConfigOptions {
  /** drizzle-kit の dbCredentials.database（localConnectionString とは別）。 */
  database: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  /** 既定 './src/db/schemes'。 */
  schema?: string;
  /** 既定 './drizzle'。 */
  out?: string;
  /** /api と DB を共有する repo は schema 由来テーブルに限定する（省略可）。 */
  tablesFilter?: string[];
  /** db:introspect（DB→JS）の casing。生成方向の `casing:'snake_case'` とは別軸（省略可）。 */
  introspect?: { casing: 'camel' | 'preserve' };
}

/**
 * drizzle.config.ts 用ファクトリ。`export default honoDrizzleConfig({ database })` で使う。
 * casing:'snake_case'・schema/out・dbCredentials（env 既定）を kit が owner として固定する。
 * drizzle-kit を kit の依存にしないため plain object を返す（drizzle-kit CLI は default export を読むだけ）。
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
  return {
    dialect: 'mysql' as const,
    schema,
    out,
    casing: 'snake_case' as const,
    ...(tablesFilter ? { tablesFilter } : {}),
    ...(introspect ? { introspect } : {}),
    dbCredentials: {
      host: host ?? process.env.DB_HOST ?? '127.0.0.1',
      port: port ?? Number(process.env.DB_PORT ?? 3306),
      user: user ?? process.env.DB_USER ?? 'root',
      password: password ?? process.env.DB_PASSWORD ?? 'root',
      database,
    },
  };
}
