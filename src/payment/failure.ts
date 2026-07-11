import { stripeFailureMessageJa } from '../stripe/failure.js';
import type { StripeFailureReason } from '../stripe/failure.js';

/**
 * Provider-agnostic status of a row in the `payment_failed` table.
 *
 * @remarks
 * - `failed` — a charge failed (card decline / iOS billing-retry).
 * - `action_required` — extra authentication pending (Stripe SCA).
 * - `canceled` — the subscription was canceled or lapsed (all providers).
 * - `resolved` — cleared after a later success / re-subscribe (kept for history).
 */
export type PaymentFailureStatus = 'failed' | 'action_required' | 'canceled' | 'resolved';

/** Provider that produced a `payment_failed` row (matches the `type` column). */
export type PaymentFailureType = 'stripe' | 'ios' | 'android';

/**
 * The statuses that still warrant a banner (everything except `resolved`).
 * Use for `WHERE status IN (...)` on read / resolve queries so the set never drifts between repos.
 *
 * @remarks Readonly tuple — spread it for Drizzle's `inArray`: `inArray(col, [...UNRESOLVED_PAYMENT_STATUSES])`.
 */
export const UNRESOLVED_PAYMENT_STATUSES = ['failed', 'action_required', 'canceled'] as const;

const CANCELED_MESSAGE_JA =
  'ご登録のプランは解約されています。引き続きプレミアム機能をご利用になるには、再度ご登録ください。';

/** In-app-purchase の failed（カード無効）はプロバイダごとに更新導線が違うため文言を分ける。 */
const IAP_FAILED_MESSAGE_JA: Record<'ios' | 'android', string> = {
  ios: 'お支払いの更新に失敗しました。App Store のお支払い情報をご確認のうえ、更新してください。',
  android: 'お支払いの更新に失敗しました。Google Play のお支払い情報をご確認ください。',
};

/**
 * Render a user-facing Japanese message for a `payment_failed` row, across providers.
 *
 * @remarks
 * Wraps {@link stripeFailureMessageJa} (decline_code → JA) and adds provider-agnostic wording for
 * `canceled` (re-subscribe prompt) and for IAP `failed` (App Store / Google Play update prompt),
 * which carry no Stripe `decline_code`. Message is generated on read so wording changes never
 * require a data migration.
 *
 * @param input.status - The row status.
 * @param input.type - The row `type` (stripe/ios/android); optional.
 * @param input.reason - The stored Stripe reason (only meaningful for Stripe failures).
 */
export function paymentFailureMessageJa(input: {
  status: PaymentFailureStatus;
  /** The row `type` (stripe/ios/android). Typed as `string` since it comes from the DB column. */
  type?: string | null;
  reason?: StripeFailureReason | null;
}): string {
  if (input.status === 'canceled') {
    return CANCELED_MESSAGE_JA;
  }
  if (input.status === 'failed' && (input.type === 'ios' || input.type === 'android')) {
    return IAP_FAILED_MESSAGE_JA[input.type];
  }
  return stripeFailureMessageJa(input.reason ?? null);
}

/**
 * Build the `payment_failed.recursions_id` (PRIMARY KEY) with a per-type namespace.
 *
 * @remarks
 * - iOS: `ios:${original_transaction_id}:${expires_date_ms}`. `original_transaction_id` is stable
 *   across re-subscribes, so keying on it alone would let the resolved-reopen guard permanently mask
 *   every event after the first. Including `expires_date_ms` makes each billing cycle a distinct row,
 *   while the same cycle's daily reconcile (billing-retry) still converges to one row.
 * - Android: `android:${orderId}` — Google issues a new orderId per subscription, so it is already
 *   cycle-specific; the `android:` prefix only guards against cross-type PK collisions.
 *
 * Stripe rows use the invoice / subscription id directly (globally unique) and need no helper.
 *
 * @remarks Fits the fleet's `payment_failed.recursions_id` `varchar(50)` (iOS ≤ ~38, Android ≤ ~36 chars).
 */
export function iapFailureKey(
  input:
    | { platform: 'ios'; originalTransactionId: string; expiresDateMs: string | number }
    | { platform: 'android'; orderId: string },
): string {
  return input.platform === 'ios'
    ? `ios:${input.originalTransactionId}:${input.expiresDateMs}`
    : `android:${input.orderId}`;
}
