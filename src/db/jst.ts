// JST 日時の整形を「DB 書き込みの副作用」として列の境界に寄せるための共有部品。
// drizzle-orm の値・型は import しない（kit の脱・型同一性方針）。各 repo が自分の
// `customType` にこれら params を渡して列を作る（ブランドは repo 側の drizzle で確定）:
//
//   import { customType } from 'drizzle-orm/mysql-core';
//   import { jstTimestampParams, jstDateParams } from '@rdlabo/hono-kit/db';
//   export const jstTimestamp = (name: string, opts?: { fsp?: number }) =>
//     customType<{ data: string | Date; driverData: string | Date }>(jstTimestampParams(opts?.fsp))(name);
//   export const jstDate = (name: string) =>
//     customType<{ data: string | null; driverData: string | null }>(jstDateParams())(name);
//
// timestamp/datetime は toDriver を置かず Date を素通し → 接続の `timezone:'+09:00'`（hyperdrive
// 既定）で mysql2 が JST 整形、整形済み文字列も素通し。Drizzle ネイティブ `mode:'date'` は Date を
// tz 層より前に UTC 文字列化して −9h で壊れるため使わない（customType pass-through が唯一クリーン）。
// date 列はクライアントの ISO/空文字を MySQL DATE が弾く＋JST 日跨ぎ正規化が要るので toJstDate を残す。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * クライアント送出の日付（ISO 8601 `...Z` / `YYYY-MM-DD` / 空文字）を MySQL DATE 用の
 * `YYYY-MM-DD`（JST）へ正規化。nullish/空/解釈不能は null。MySQL DATE は ISO を弾く
 * （ER_TRUNCATED_WRONG_VALUE）ため driver では代替できず、列の toDriver に必要。
 */
export function toJstDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    return null;
  }
  const jst = new Date(ms + JST_OFFSET_MS);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}`;
}

/** `customType` に渡す params: `timestamp(fsp)` 列（created_at 群）。Date 素通し（pass-through）。 */
export const jstTimestampParams = (fsp?: number): { dataType: () => string } => ({
  dataType: () => (fsp != null ? `timestamp(${fsp})` : 'timestamp'),
});

/** `customType` に渡す params: `datetime` 列（payment.limit_at 等）。Date 素通し（pass-through）。 */
export const jstDatetimeParams = (fsp?: number): { dataType: () => string } => ({
  dataType: () => (fsp != null ? `datetime(${fsp})` : 'datetime'),
});

/** `customType` に渡す params: `date` 列（expiry_date 等）。toJstDate で文字列を正規化。 */
export const jstDateParams = (): {
  dataType: () => string;
  toDriver: (value: string | null) => string | null;
} => ({
  dataType: () => 'date',
  toDriver: (value: string | null) => toJstDate(value),
});
