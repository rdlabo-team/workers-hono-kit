import { createConnection } from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';

/**
 * Hyperdrive バインディングの最小形（@cloudflare/workers-types への依存を避けるための構造型）。
 */
export interface HyperdriveLike {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
}

/**
 * Hyperdrive バインディングから mysql2 の createConnection 用オプションを作る。
 * `disableEval: true`（Workers で eval 不可）は既定で付与。`extra` で timezone 等を上書き/追加。
 *
 * `decimalNumbers: true`: DECIMAL/NEWDECIMAL を文字列でなく JS number で返す。Drizzle の
 * `$inferSelect`（decimal→string）と生 SQL reads の戻り値を、各 repo の数値ドメイン型
 * （nutrition の number 等）に揃えるため既定で有効化。precision/scale が JS の安全整数域
 * （decimal(15,2) 程度まで）を超える列が無いことが前提。
 *
 * `timezone: '+09:00'`: フリートの接続先 RDB は session time_zone=Asia/Tokyo。mysql2 の driver
 * `timezone` 既定は `'local'`＝Workers では UTC で、揃わないと `datetime/timestamp` の生 Date 読みが
 * +9h・生 Date 書きが −9h ズレる（NestJS は JST 実行で一致＝移植で顕在化する潜在バグ）。driver を
 * 固定すれば round-trip の観測値は DB の session tz に非依存（内部格納 UTC 値だけ変わるが app 不可視）。
 * 非 JST repo は `extra: { timezone: '...' }` で上書き可。
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
    timezone: '+09:00',
    ...extra,
  };
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * primary/replica の接続を開いて `fn` を実行し、finally で `ctx.waitUntil` 越しに閉じる
 * （receptray/tipsys の worker entry の接続ライフサイクル相当）。
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
