/**
 * Drizzle 列ヘルパー（フリート共通）。各 repo の `custom-types.ts` / `columns.ts` 薄いラッパーは不要。
 *
 * @remarks
 * `drizzle-orm` は **peer**（consumer が 1 本解決）。kit は `drizzle-orm` を bundled しない。
 * `.default(sql\`…\`)` 連鎖は consumer の `sql` と型を合わせるため、戻り型は意図的に緩い（declaration は `any`）。
 *
 * **DEFAULT / ON UPDATE CURRENT_TIMESTAMP** … MySQL サーバ側の既定値（列を省略した INSERT / UPDATE）。
 * 接続 `timezone:'+09:00'`（{@link hyperdriveConnectionOptions}）が効くのは **アプリから Date を bind するとき**。
 * 両者を混同しないこと（`datetime-wire` / `drizzle-smoke` の JST テスト参照）。
 */
import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/mysql-core';
import { decimalNumberParams } from './decimal.js';
import type { DecimalNumberConfig } from './decimal.js';
import { jstDateParams, jstDatetimeParams, jstTimestampParams } from './jst.js';

/**
 * `ON UPDATE CURRENT_TIMESTAMP` 用式（MySQL セッション時刻）。
 * customType 列は `.onUpdateNow()` が無いため `.$onUpdateFn(() => jstOnUpdateNow(fsp))` と併用する。
 */
export const jstOnUpdateNow = (fsp?: number) =>
  fsp != null ? sql`(CURRENT_TIMESTAMP(${sql.raw(String(fsp))}))` : sql`(CURRENT_TIMESTAMP)`;

/** MySQL `timestamp` — pass-through。Date は接続 `timezone:'+09:00'` で mysql2 が JST 整形。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle-orm は consumer と単一解決必須。戻り any で .default(sql) の型衝突を避ける。
export const jstTimestamp = (name: string, opts?: { fsp?: number }): any =>
  customType<{ data: string | Date; driverData: string | Date }>(jstTimestampParams(opts?.fsp))(name);

/** MySQL `datetime` — {@link jstTimestamp} と同じ pass-through 方針。 */
export const jstDatetime = (name: string, opts?: { fsp?: number }): any =>
  customType<{ data: string | Date; driverData: string | Date }>(jstDatetimeParams(opts?.fsp))(name);

/** MySQL `date` — INSERT/UPDATE 時に ISO / 空文字を `YYYY-MM-DD` へ正規化（`toDriver`）。 */
export const jstDate = (name: string): any =>
  customType<{ data: string | null; driverData: string | null }>(jstDateParams())(name);

/** MySQL `decimal` — SELECT は `fromDriver` で string→number、書込は number をそのまま bind。 */
export const decimalNumber = (name: string, config: DecimalNumberConfig): any =>
  customType<{ data: number | null; driverData: number | string | null }>(decimalNumberParams(config))(name);
