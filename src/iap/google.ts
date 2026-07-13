/**
 * Google Play (Android Publisher) subscription helpers.
 *
 * @remarks
 * SDK-free and duck-typed like {@link ./apple.ts}. `classifyGoogleSubscription` maps a
 * `purchases.subscriptions.get` response (or its 410 error) to a state; the consumer persists it
 * (canceled/gone → `canceled`, active → resolve). `getGoogleSubscription` / `googleAccessToken`
 * perform the OAuth + Android Publisher calls.
 */

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;

/** Android Publisher `purchases.subscriptions.get` response (fields consumed here). */
export interface GoogleSubscriptionPurchase {
  startTimeMillis?: string;
  expiryTimeMillis?: string;
  /** `false` once the user turns off auto-renew (will cancel at period end). */
  autoRenewing?: boolean;
  /** Present once canceled (0=user / 1=system / 2=replaced / 3=developer). */
  cancelReason?: number;
  /** Set when Google returns an error body (e.g. `{ code: 410 }` for a long-expired token). */
  error?: { code?: number; message?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * Subscription state derived from a Google subscriptions.get response.
 * - `canceled` — expired and will not renew (autoRenewing=false or a cancelReason) → persist `canceled`.
 * - `gone` — Google 410 "no longer available" (long-churned) → persist `canceled` (best-effort).
 * - `active` — a valid (non-expired) subscription → resolve any open failure.
 * - `unknown` — indeterminate / transient error → no-op.
 *
 * @remarks Google's account-hold / grace-period (payment failed but auto-renew still on — the Android
 * analogue of Apple's `billing_retry`) is currently reported as `active`/`unknown`, not a distinct
 * "failed" state. If that distinction is needed later, add it to this union in a minor release (adding
 * a member is semi-breaking for exhaustive `switch` consumers).
 */
export type GoogleSubscriptionState = 'canceled' | 'gone' | 'active' | 'unknown';

/** Google subscription classification plus provider diagnostic codes used by persistence. */
export interface GoogleSubscriptionClassification {
  state: GoogleSubscriptionState;
  /** Google error-body code, such as 410. */
  statusCode?: number;
  /** Google cancellation reason (0=user, 1=system, 2=replaced, 3=developer). */
  cancelReason?: number;
}

/**
 * Classify a Google subscriptions.get response into a {@link GoogleSubscriptionState}.
 *
 * @param purchase - The response body (duck-typed); may be `{ error: { code } }`.
 * @param now - Current epoch-ms (`Date.now()`); injected for determinism/testing.
 */
export function classifyGoogleSubscription(purchase: unknown, now: number): GoogleSubscriptionClassification {
  const p = asRecord(purchase);
  if (!p) {
    return { state: 'unknown' };
  }
  const err = asRecord(p.error);
  if (err) {
    // 410 = "The subscription purchase is no longer available for query" (expired too long) = churned.
    const statusCode = typeof err.code === 'number' ? err.code : undefined;
    return { state: statusCode === 410 ? 'gone' : 'unknown', statusCode };
  }
  const expiryMs = Number(p.expiryTimeMillis);
  const hasValidExpiry = Number.isFinite(expiryMs);
  const isExpired = hasValidExpiry && expiryMs < now;
  const cancelReason = typeof p.cancelReason === 'number' ? p.cancelReason : undefined;
  const willNotRenew = p.autoRenewing === false || cancelReason !== undefined;
  if (isExpired && willNotRenew) {
    return { state: 'canceled', cancelReason };
  }
  if (hasValidExpiry && !isExpired) {
    return { state: 'active', cancelReason };
  }
  return { state: 'unknown', cancelReason };
}

/** OAuth service-account credentials for the Android Publisher API (per-app; inject, never hardcode in kit). */
export interface GoogleOAuthCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

/**
 * Exchange a refresh token for an Android Publisher access token.
 *
 * @param creds - The per-app OAuth credentials.
 * @param fetchImpl - Injectable fetch (tests).
 */
export async function googleAccessToken(creds: GoogleOAuthCredentials, fetchImpl?: typeof fetch): Promise<string> {
  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    grant_type: 'refresh_token',
    refresh_token: creds.refresh_token,
  }).toString();
  const res = (await (fetchImpl ?? fetch)('https://accounts.google.com/o/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }).then((r) => r.json())) as { access_token?: string };
  if (!res.access_token) {
    // 静かに '' を返すと後続が error body → 'unknown' に劣化し、refresh token 失効(invalid_grant)を
    // 見逃す。呼び出し側に可視化するため throw する。
    throw new Error('googleAccessToken: no access_token in token response (refresh_token expired?)');
  }
  return res.access_token;
}

/**
 * Fetch a subscription purchase from the Android Publisher API.
 *
 * @remarks
 * Returns the raw JSON (including `{ error: { code } }` bodies for 4xx such as 410) so the caller can
 * pass it to {@link classifyGoogleSubscription}. `packageName` / `subscriptionId` are per-app.
 */
export async function getGoogleSubscription(opts: {
  packageName: string;
  subscriptionId: string;
  purchaseToken: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleSubscriptionPurchase> {
  const url =
    `https://www.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(opts.packageName)}` +
    `/purchases/subscriptions/${encodeURIComponent(opts.subscriptionId)}/tokens/${encodeURIComponent(opts.purchaseToken)}`;
  // access_token はクエリに載せず Authorization ヘッダで送る（URL ログ/プロキシへの秘匿情報漏洩を防ぐ）。
  return (opts.fetchImpl ?? fetch)(url, { headers: { authorization: `Bearer ${opts.accessToken}` } }).then(
    (r) => r.json() as Promise<GoogleSubscriptionPurchase>,
  );
}
