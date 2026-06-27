import type Stripe from 'stripe';

/**
 * Stripe オブジェクトの test fixture factory。実 SDK 型は巨大なので、テストが参照する範囲だけを
 * 妥当な既定値で組み、`over` で上書きする（最後に 1 度だけ Stripe 型へキャスト）。fleet 各 repo の
 * 課金テストで同じダミー PaymentIntent/Event/... を手組みしていた重複を集約する。
 */

export function fakeApiList<T>(data: T[], over: Partial<Stripe.ApiList<T>> = {}): Stripe.ApiList<T> {
  return {
    object: 'list',
    data,
    has_more: false,
    url: '/v1/_test',
    ...over,
  };
}

export function fakePaymentIntent(over: Partial<Stripe.PaymentIntent> = {}): Stripe.PaymentIntent {
  return {
    id: 'pi_test_1',
    object: 'payment_intent',
    amount: 1000,
    currency: 'jpy',
    status: 'succeeded',
    created: 1_700_000_000,
    ...over,
  } as Stripe.PaymentIntent;
}

export function fakeStripeEvent(type: string, dataObject: unknown, over: Partial<Stripe.Event> = {}): Stripe.Event {
  return {
    id: 'evt_test_1',
    object: 'event',
    api_version: '2024-06-20',
    created: 1_700_000_000,
    livemode: false,
    type,
    data: { object: dataObject },
    ...over,
  } as Stripe.Event;
}

export function fakeCheckoutSession(over: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_test_1',
    object: 'checkout.session',
    url: 'https://checkout.stripe.test/cs_test_1',
    mode: 'subscription',
    status: 'open',
    ...over,
  } as Stripe.Checkout.Session;
}

export function fakeCustomer(over: Partial<Stripe.Customer> = {}): Stripe.Customer {
  return {
    id: 'cus_test_1',
    object: 'customer',
    created: 1_700_000_000,
    livemode: false,
    ...over,
  } as Stripe.Customer;
}

export function fakePrice(over: Partial<Stripe.Price> = {}): Stripe.Price {
  return {
    id: 'price_test_1',
    object: 'price',
    active: true,
    currency: 'jpy',
    unit_amount: 1000,
    ...over,
  } as Stripe.Price;
}

export function fakeSubscription(over: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_test_1',
    object: 'subscription',
    status: 'active',
    customer: 'cus_test_1',
    created: 1_700_000_000,
    ...over,
  } as Stripe.Subscription;
}
