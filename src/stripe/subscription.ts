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
  const paymentIntent = payment?.type === 'payment_intent' ? payment.payment_intent : null;
  return typeof paymentIntent === 'object' && paymentIntent !== null ? paymentIntent : null;
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
  let payment: StripeReconcilePaymentRow<TDate> | null = null;
  if (action === 'trial' || paymentIntent) {
    const period = subscription.items.data.at(0);
    if (!period) {
      throw new Error(`Subscription has no items: ${subscription.id}`);
    }
    const dates = {
      limitAt: formatDate(new Date(period.current_period_end * 1000)),
      createdAt: formatDate(new Date(period.current_period_start * 1000)),
    };
    if (action === 'trial') {
      payment = {
        customerId,
        recursionsId: invoice.id,
        status: 'trialing',
        detail: JSON.stringify(invoice),
        ...dates,
      };
    } else if (paymentIntent) {
      payment = {
        customerId,
        recursionsId: paymentIntent.id,
        status: paymentIntent.status,
        detail: JSON.stringify(paymentIntent),
        ...dates,
      };
    }
  }

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
