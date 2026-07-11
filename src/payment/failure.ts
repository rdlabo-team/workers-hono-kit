import { stripeFailureMessageJa } from '../stripe/failure.js';
import type { PaymentFailureReason } from '../stripe/failure.js';

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
  reason?: PaymentFailureReason | null;
}): string {
  if (input.status === 'canceled') {
    return CANCELED_MESSAGE_JA;
  }
  if (input.status === 'failed' && (input.type === 'ios' || input.type === 'android')) {
    return IAP_FAILED_MESSAGE_JA[input.type];
  }
  const stripeReason = input.reason && !('provider' in input.reason) ? input.reason : null;
  return stripeFailureMessageJa(stripeReason);
}

/**
 * Build the provider-native `payment_failed.recursions_id`.
 *
 * @remarks
 * - iOS: `${original_transaction_id}:${expires_date_ms}`. `original_transaction_id` is stable
 *   across re-subscribes, so keying on it alone would let the resolved-reopen guard permanently mask
 *   every event after the first. Including `expires_date_ms` makes each billing cycle a distinct row,
 *   while the same cycle's daily reconcile (billing-retry) still converges to one row.
 * - Android: `${orderId}` — Google issues a new orderId per subscription, so it is already cycle-specific.
 *
 * Stripe rows use the invoice / subscription id directly (globally unique) and need no helper.
 *
 * The provider is stored separately in the `type` column. Provider-native ID formats are disjoint in practice
 * (Apple numeric pair / Google `GPA.*` / Stripe `in_*` or `sub_*`), so duplicating `type` in the primary-key value
 * is unnecessary.
 */
export function iapFailureKey(
  input:
    | { platform: 'ios'; originalTransactionId: string; expiresDateMs: string | number }
    | { platform: 'android'; orderId: string },
): string {
  return input.platform === 'ios' ? `${input.originalTransactionId}:${input.expiresDateMs}` : input.orderId;
}
