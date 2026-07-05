/**
 * Drizzle 列ヘルパー（フリート共通）。各 repo の `custom-types.ts` / `columns.ts` 薄いラッパーは不要。
 *
 * @remarks
 * `drizzle-orm` は **peer**（consumer が 1 本解決）。kit は `drizzle-orm` を bundled しない。
 * 戻り型は `customType` 推論そのまま（`MySqlCustomColumnBuilder<…>`）で `any` を使わない。
 * これにより consumer テーブルの `$inferSelect` に列の意味型（`string | Date` / `number | null` など）が伝播する。
 *
 * **前提（単一 drizzle コピー）**: drizzle の `SQL` は private フィールド `shouldInlineParams` を持つ
 * **名目型**なので、kit と consumer が drizzle の別コピーを解決すると
 * `jstTimestamp(…).default(sql\`…\`)` が `TS2345: separate declarations of a private property
 * 'shouldInlineParams'` で落ちる。フリートは kit を `file:` リンク参照するため kit 配下に drizzle が
 * ネストし二重コピーになりやすい。consumer 側 tsconfig の `paths` で `drizzle-orm` を **自身の 1 コピーへ
 * 固定**して単一化すること（README「Drizzle 列ヘルパー」参照）。published 版（単一コピー）ではそのまま単一。
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
export const jstTimestamp = (name: string, opts?: { fsp?: number }) =>
  customType<{ data: string | Date; driverData: string | Date }>(jstTimestampParams(opts?.fsp))(name);

/** MySQL `datetime` — {@link jstTimestamp} と同じ pass-through 方針。 */
export const jstDatetime = (name: string, opts?: { fsp?: number }) =>
  customType<{ data: string | Date; driverData: string | Date }>(jstDatetimeParams(opts?.fsp))(name);

/** MySQL `date` — INSERT/UPDATE 時に ISO / 空文字を `YYYY-MM-DD` へ正規化（`toDriver`）。 */
export const jstDate = (name: string) =>
  customType<{ data: string | null; driverData: string | null }>(jstDateParams())(name);

/** MySQL `decimal` — SELECT は `fromDriver` で string→number、書込は number をそのまま bind。 */
export const decimalNumber = (name: string, config: DecimalNumberConfig) =>
  customType<{ data: number | null; driverData: number | string | null }>(decimalNumberParams(config))(name);
