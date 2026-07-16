import type Stripe from 'stripe';
import { classifyStripeReconcile } from './reconcile.js';
import type { StripeReconcileAction } from './reconcile.js';

export const STRIPE_RECONCILE_INVOICE_EXPAND = ['payments.data.payment.payment_intent', 'customer'] as const;

export interface StripeReconcilePaymentRow<TDate = Date> {
  customerId: string;
  recursionsId: string;
  status: string;
  detail: string;
  limitAt: TDate;
  createdAt: TDate;
}

export interface StripeReconcilePlan<TDate = Date> {
  action: StripeReconcileAction;
  paymentIntent: Stripe.PaymentIntent | null;
  payment: StripeReconcilePaymentRow<TDate> | null;
}

export function stripePaymentIntent(invoice: Stripe.Invoice): Stripe.PaymentIntent | null {
  const payment = invoice.payments?.data[0]?.payment;
  // Stripe's generated type treats data[0] as present, but genuine trials return an empty payments array.
  return payment?.type === 'payment_intent' ? (payment.payment_intent as Stripe.PaymentIntent) : null;
}

export function buildStripeReconcilePlan<TDate = Date>(options: {
  subscription: Stripe.Subscription;
  invoice: Stripe.Invoice;
  customerId: string;
  formatDate?: (value: Date) => TDate;
}): StripeReconcilePlan<TDate> {
  const { subscription, invoice, customerId } = options;
  const formatDate = options.formatDate ?? ((value: Date) => value as TDate);
  const paymentIntent = stripePaymentIntent(invoice);
  const action = classifyStripeReconcile({ ...subscription, latest_invoice: invoice });
  const period = subscription.items.data[0];

  const dates = {
    limitAt: formatDate(new Date(period.current_period_end * 1000)),
    createdAt: formatDate(new Date(period.current_period_start * 1000)),
  };
  const payment =
    action === 'trial'
      ? {
          customerId,
          recursionsId: invoice.id,
          status: 'trialing',
          detail: JSON.stringify(invoice),
          ...dates,
        }
      : paymentIntent
        ? {
            customerId,
            recursionsId: paymentIntent.id,
            status: paymentIntent.status,
            detail: JSON.stringify(paymentIntent),
            ...dates,
          }
        : null;

  return { action, paymentIntent, payment };
}

export async function assertStripeCustomerUpdated(options: {
  productId: string;
  customerId: string;
  subscriptionId: string;
  updateCustomer: (receipt: string, productId: string, customerId: string) => Promise<number | { affected: number }>;
  countCustomer: (productId: string, customerId: string) => Promise<number>;
}): Promise<void> {
  const updated = await options.updateCustomer(options.subscriptionId, options.productId, options.customerId);
  const affected = typeof updated === 'number' ? updated : updated.affected;
  if (affected !== 0) {
    return;
  }

  if ((await options.countCustomer(options.productId, options.customerId)) === 0) {
    throw new Error(`Customer not found: ${options.customerId}`);
  }
}
