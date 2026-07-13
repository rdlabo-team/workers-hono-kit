/**
 * Apple App Store (StoreKit / verifyReceipt) helpers.
 *
 * @remarks
 * Provider-agnostic and SDK-free: inputs are duck-typed `unknown` JSON (Apple ships no SDK), matching
 * the `stripe/failure.ts` approach. `classifyAppleRenewal` maps a verifyReceipt response to a renewal
 * state; the consumer decides how to persist it (billing_retry → `failed`, lapsed → `canceled`,
 * active → resolve). `verifyAppleReceipt` performs the production→sandbox verification call.
 */

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;

const toArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Apple `pending_renewal_info[]` entry (fields consumed here). */
export interface ApplePendingRenewalInfo {
  /** Links this renewal info to a subscription group / receipt (used to pick the matching entry). */
  original_transaction_id?: string;
  /** `'1'` while Apple is retrying billing because the payment method failed (= card invalid). */
  is_in_billing_retry_period?: string;
  /** `'0'` = auto-renew turned off (will lapse at period end). */
  auto_renew_status?: string;
  [key: string]: unknown;
}

/** Apple `latest_receipt_info[]` entry (fields consumed here). */
export interface AppleLatestReceiptInfo {
  original_transaction_id?: string;
  /** Subscription expiry as epoch-ms string (stable regardless of the `expires_date` string format). */
  expires_date_ms?: string;
  [key: string]: unknown;
}

/** Apple `verifyReceipt` response (fields consumed here). */
export interface AppleVerifyReceiptResponse {
  status?: number;
  environment?: string;
  latest_receipt_info?: AppleLatestReceiptInfo[];
  pending_renewal_info?: ApplePendingRenewalInfo[];
  [key: string]: unknown;
}

/**
 * Renewal state derived from an Apple verifyReceipt response.
 * - `billing_retry` — Apple is retrying a failed payment (card invalid) → persist as `failed`.
 * - `lapsed` — auto-renew off and expired → persist as `canceled`.
 * - `active` — a valid (non-expired) subscription → resolve any open failure.
 * - `unknown` — indeterminate (no receipt, or expired with auto-renew on and no retry) → no-op.
 */
export type AppleRenewalState = 'billing_retry' | 'lapsed' | 'active' | 'unknown';

/** Apple renewal classification plus the exact provider fields used to reach it. */
export interface AppleRenewalClassification {
  state: AppleRenewalState;
  originalTransactionId?: string;
  expiresDateMs?: string;
  /** Apple verifyReceipt response status (normally 0 for a successfully verified receipt). */
  statusCode?: number;
  /** Value from the pending-renewal entry matched to `originalTransactionId`. */
  billingRetryStatus?: string;
  /** Value from the pending-renewal entry matched to `originalTransactionId`. */
  autoRenewStatus?: string;
}

/**
 * Classify an Apple verifyReceipt response into an {@link AppleRenewalState}.
 *
 * @remarks
 * The most recent renewal (max `expires_date_ms`) is used regardless of array order. Sandbox is NOT
 * filtered here — the consumer should skip `environment === 'Sandbox'` before persisting to a
 * production table (see {@link AppleVerifyReceiptResponse.environment}).
 *
 * @param verify - The verifyReceipt response (duck-typed).
 * @param now - Current epoch-ms (`Date.now()`); injected for determinism/testing.
 * @returns The state plus the latest `original_transaction_id` / `expires_date_ms` (for the row key).
 */
export function classifyAppleRenewal(verify: unknown, now: number): AppleRenewalClassification {
  const v = asRecord(verify);
  const statusCode = typeof v?.status === 'number' ? v.status : undefined;
  // 消耗型など expires_date_ms 欠損エントリを除外してから最新（max expires）を選ぶ。
  // 欠損値を Number() すると NaN で比較が常に false になり、先頭の欠損行が最後まで残って
  // 誤って 'active'（isExpired=false）を返すため、有効な expires を持つ行だけを対象にする。
  const infos = toArray<AppleLatestReceiptInfo>(v?.latest_receipt_info).filter((e) =>
    Number.isFinite(Number(e.expires_date_ms)),
  );
  const latest = infos.reduce<AppleLatestReceiptInfo | undefined>((acc, cur) => {
    if (!acc) {
      return cur;
    }
    return Number(cur.expires_date_ms) > Number(acc.expires_date_ms) ? cur : acc;
  }, undefined);
  const originalTransactionId = latest?.original_transaction_id;
  if (!latest || !originalTransactionId) {
    return { state: 'unknown', statusCode };
  }
  // 複数サブスク商品時に別商品の renewal info を読まないよう、latest と同じ original_transaction_id の
  // pending エントリを優先（無ければ先頭にフォールバック）。
  const pendingArr = toArray<ApplePendingRenewalInfo>(v?.pending_renewal_info);
  const pending = pendingArr.find((p) => p.original_transaction_id === originalTransactionId) ?? pendingArr.at(0);
  const expiresMs = Number(latest.expires_date_ms);
  const isExpired = Number.isFinite(expiresMs) && expiresMs < now;
  const base = {
    originalTransactionId,
    expiresDateMs: latest.expires_date_ms,
    statusCode,
    billingRetryStatus: pending?.is_in_billing_retry_period,
    autoRenewStatus: pending?.auto_renew_status,
  };

  if (pending?.is_in_billing_retry_period === '1') {
    return { state: 'billing_retry', ...base };
  }
  if (pending?.auto_renew_status === '0' && isExpired) {
    return { state: 'lapsed', ...base };
  }
  if (!isExpired) {
    return { state: 'active', ...base };
  }
  return { state: 'unknown', ...base };
}

/**
 * Verify an App Store receipt against Apple, falling back from production to sandbox.
 *
 * @remarks
 * Mirrors the fleet's long-standing verify flow: POST to the production endpoint, and if
 * `status !== 0` retry against sandbox. Returns `null` when both reject. The `password` (shared
 * secret) is per-app and must be injected. `fetchImpl` is injectable for tests.
 *
 * @remarks Caveat: any non-zero `status` (including Apple's *retryable* 21005/21009) collapses to
 * `null`, so a transient Apple outage is indistinguishable from a genuinely invalid receipt. Do not
 * treat `null` as "subscription gone" without other signals. Also throws if a response is not JSON.
 *
 * @returns The parsed response, or `null` for an invalid (or unverifiable) receipt.
 */
export async function verifyAppleReceipt(
  receipt: string,
  opts: { password: string; fetchImpl?: typeof fetch },
): Promise<AppleVerifyReceiptResponse | null> {
  const body = JSON.stringify({ 'receipt-data': receipt, password: opts.password });
  const doFetch = opts.fetchImpl ?? fetch;
  const post = (url: string): Promise<AppleVerifyReceiptResponse> =>
    doFetch(url, { method: 'POST', body }).then((r) => r.json() as Promise<AppleVerifyReceiptResponse>);

  let verify = await post('https://buy.itunes.apple.com/verifyReceipt');
  if (verify.status !== 0) {
    verify = await post('https://sandbox.itunes.apple.com/verifyReceipt');
    if (verify.status !== 0) {
      return null;
    }
  }
  return verify;
}
