import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  assertStripeCustomerUpdated,
  buildStripeReconcilePlan,
  STRIPE_RECONCILE_INVOICE_EXPAND,
} from './subscription.js';

const subscription = (invoice: Stripe.Invoice): Stripe.Subscription =>
  ({
    id: 'sub_1',
    status: 'active',
    latest_invoice: invoice,
    items: { data: [{ current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 }] },
  }) as unknown as Stripe.Subscription;

describe('Stripe subscription reconciliation', () => {
  it('uses the Basil invoice payment path and creates a succeeded payment row', () => {
    const paymentIntent = { id: 'pi_basil', status: 'succeeded' } as Stripe.PaymentIntent;
    const invoice = {
      id: 'in_1',
      status: 'paid',
      customer: { id: 'cus_1' },
      payments: { data: [{ payment: { type: 'payment_intent', payment_intent: paymentIntent } }] },
    } as unknown as Stripe.Invoice;

    const plan = buildStripeReconcilePlan({ subscription: subscription(invoice), invoice, customerId: 'cus_1' });

    expect(STRIPE_RECONCILE_INVOICE_EXPAND).toContain('payments.data.payment.payment_intent');
    expect(plan.action).toBe('clear');
    expect(plan.payment).toMatchObject({ recursionsId: 'pi_basil', status: 'succeeded' });
  });

  it('creates a trial row only when the paid invoice has no PaymentIntent', () => {
    const invoice = {
      id: 'in_trial',
      status: 'paid',
      customer: { id: 'cus_1' },
      payments: { data: [] },
    } as unknown as Stripe.Invoice;

    const plan = buildStripeReconcilePlan({ subscription: subscription(invoice), invoice, customerId: 'cus_1' });

    expect(plan.action).toBe('trial');
    expect(plan.payment).toMatchObject({ recursionsId: 'in_trial', status: 'trialing' });
  });
});

describe('assertStripeCustomerUpdated', () => {
  it('accepts affected=0 when the customer still exists', async () => {
    const countCustomer = vi.fn().mockResolvedValue(1);
    await expect(
      assertStripeCustomerUpdated({
        productId: 'prod_1',
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        updateCustomer: vi.fn().mockResolvedValue(0),
        countCustomer,
      }),
    ).resolves.toBeUndefined();
    expect(countCustomer).toHaveBeenCalledOnce();
  });

  it('throws only when affected=0 and the customer does not exist', async () => {
    await expect(
      assertStripeCustomerUpdated({
        productId: 'prod_1',
        customerId: 'cus_missing',
        subscriptionId: 'sub_1',
        updateCustomer: vi.fn().mockResolvedValue({ affected: 0 }),
        countCustomer: vi.fn().mockResolvedValue(0),
      }),
    ).rejects.toThrow('Customer not found: cus_missing');
  });

  it('does not count the customer when the update affected rows', async () => {
    const countCustomer = vi.fn();
    await assertStripeCustomerUpdated({
      productId: 'prod_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      updateCustomer: vi.fn().mockResolvedValue(1),
      countCustomer,
    });
    expect(countCustomer).not.toHaveBeenCalled();
  });
});
