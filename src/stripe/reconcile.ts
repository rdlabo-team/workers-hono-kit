/**
 * Stripe subscription reconcile classification.
 *
 * @remarks
 * SDK-free / duck-typed (like `failure.ts`). Given an **expanded** subscription (its `latest_invoice`
 * with the PaymentIntent resolved and the `customer`), decide what the `payment_failed` table should
 * do. The consumer performs the DB writes; this only encodes the branch order.
 *
 * The branch order matters: subscription **termination is evaluated before `succeeded`**, so a
 * voluntary cancel (cancel_at_period_end — its final invoice is paid, PaymentIntent=succeeded) is
 * still recorded instead of being swallowed by the "succeeded → clear" branch.
 *
 * Both Stripe API shapes are accepted:
 * - legacy `invoice.payment_intent` (id or expanded object)
 * - v20+ `invoice.payments.data[0].payment.payment_intent`
 * The PaymentIntent must be **expanded** (carry a `status`) for `clear`/dunning detection; when it is
 * only an id, `canceled`/`trial` are still detected but `succeeded`/dunning fall through to `none`.
 */

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/**
 * What a reconcile pass should do with the `payment_failed` table for a subscription.
 * - `trial` — trialing (paid invoice, no PaymentIntent). Consumer upserts payment; typically clears failures.
 * - `clear` — active/trialing with a succeeded charge → resolve any open failure.
 * - `canceled` — subscription ended (canceled/incomplete_expired) → record a `canceled` row.
 * - `failed` — dunning with `requires_payment_method` → record a `failed` row.
 * - `action_required` — dunning with `requires_action` (SCA) → record an `action_required` row.
 * - `none` — nothing to record (e.g. active + not-yet-charged, or PaymentIntent not expanded).
 */
export type StripeReconcileAction = 'trial' | 'clear' | 'canceled' | 'failed' | 'action_required' | 'none';

const DUNNING_STATUSES = new Set(['past_due', 'unpaid', 'incomplete']);

/** Resolve the PaymentIntent object/id from an invoice across Stripe API versions. */
function resolvePaymentIntent(invoice: Record<string, unknown> | null): {
  present: boolean;
  status?: string;
} {
  if (!invoice) {
    return { present: false };
  }
  // legacy: invoice.payment_intent (id string or expanded object)
  const direct = invoice.payment_intent;
  if (direct !== null && direct !== undefined) {
    return { present: true, status: str(asRecord(direct)?.status) };
  }
  // v20+: invoice.payments.data[0].payment.payment_intent
  const payments = asRecord(invoice.payments);
  const data = Array.isArray(payments?.data) ? (payments.data as unknown[]) : [];
  const pi = asRecord(asRecord(asRecord(data[0])?.payment)?.payment_intent);
  if (pi) {
    return { present: true, status: str(pi.status) };
  }
  const piId = str(asRecord(asRecord(data[0])?.payment)?.payment_intent);
  return { present: piId !== undefined, status: undefined };
}

/**
 * Classify an expanded Stripe subscription into a {@link StripeReconcileAction}.
 *
 * @param subscription - The subscription with `latest_invoice` + PaymentIntent expanded (duck-typed).
 */
export function classifyStripeReconcile(subscription: unknown): StripeReconcileAction {
  const sub = asRecord(subscription);
  if (!sub) {
    return 'none';
  }
  const subStatus = str(sub.status);
  const invoice = asRecord(sub.latest_invoice);
  const invoiceStatus = str(invoice?.status);
  const pi = resolvePaymentIntent(invoice);

  // Termination first: evaluated before `trial` and before `succeeded`, so a canceled subscription is
  // always recorded — whether its final invoice is paid (voluntary cancel, PI=succeeded), a trial
  // (paid invoice, no PI), or the PaymentIntent is unexpanded. Otherwise it would be swallowed by the
  // `trial` / `succeeded → clear` branches and the cancellation would never be recorded.
  if (subStatus === 'canceled' || subStatus === 'incomplete_expired') {
    return 'canceled';
  }
  if (invoiceStatus === 'paid' && !pi.present) {
    return 'trial';
  }
  if (pi.present) {
    if (pi.status === 'succeeded') {
      return 'clear';
    }
    if (subStatus !== undefined && DUNNING_STATUSES.has(subStatus)) {
      if (pi.status === 'requires_action') {
        return 'action_required';
      }
      if (pi.status === 'requires_payment_method') {
        return 'failed';
      }
    }
  }
  return 'none';
}
