import type { Pool } from 'mysql2/promise';
import type { DecodedIdToken } from '../firebase/firebase-verifier';
import type { FakeFirebaseVerifier } from './fakes';

/**
 * app interceptor 互換の認証ヘッダ（`x-amz-security-token` + `x-amz-meta-*`）を組む。
 * fleet 全 hono repo の route spec で同形に重複していたものを集約。
 *
 * - `version` は `app_version`(varchar(10)) に入るため 10 文字以内。
 * - `contentType: null` を渡すと content-type を付けない（GET 等）。
 */
export function authHeaders(
  token: string,
  opts: { version?: string; uuid?: string; contentType?: string | null } = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-amz-security-token': token,
    'x-amz-meta-version': opts.version ?? '1.0.0',
    'x-amz-meta-uuid': opts.uuid ?? 'test-uuid',
  };
  if (opts.contentType !== null) {
    headers['content-type'] = opts.contentType ?? 'application/json';
  }
  return headers;
}

/**
 * fake firebase にトークンを登録するだけの薄いヘルパ（DB を触らない）。戻り値はトークン。
 * `users` テーブル形が repo 固有（例: airlec は email 主）で provisionUser が合わない場合に使う。
 */
export function registerFirebaseToken(
  firebase: FakeFirebaseVerifier,
  uid: string,
  record: Partial<DecodedIdToken> = {},
  token = `tok-${uid}`,
): string {
  firebase.register(token, { uid, ...record });
  return token;
}

/**
 * fake firebase にトークンを登録し、`users(firebase_uid)` 行を用意して userId を返す。
 * `users(id, firebase_uid, agree)` の fleet 共通形を前提（foodlabel/receptray など）。同 uid の
 * 既存行があれば再利用する（冪等）。users テーブル形が異なる repo は registerFirebaseToken + 独自
 * provision を使う。
 */
export async function provisionUser(
  pool: Pool,
  firebase: FakeFirebaseVerifier,
  opts: { uid: string; token?: string; agree?: number; email?: string },
): Promise<{ userId: number; uid: string; token: string }> {
  const token = registerFirebaseToken(firebase, opts.uid, opts.email ? { email: opts.email } : {}, opts.token);

  const [existing] = await pool.query('SELECT id FROM users WHERE firebase_uid = ?', [opts.uid]);
  const rows = existing as { id: number }[];
  if (rows.length > 0) {
    return { userId: rows[0].id, uid: opts.uid, token };
  }

  const [res] = await pool.query('INSERT INTO users (agree, firebase_uid) VALUES (?, ?)', [opts.agree ?? 1, opts.uid]);
  return { userId: (res as { insertId: number }).insertId, uid: opts.uid, token };
}
