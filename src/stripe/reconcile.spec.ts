import { describe, expect, it } from 'vitest';
import { classifyStripeReconcile } from './reconcile.js';

const sub = (opts: {
  status: string;
  invoiceStatus?: string;
  piStatus?: string | null; // null = no PaymentIntent
  v20?: boolean;
}) => {
  const invoice: Record<string, unknown> = { status: opts.invoiceStatus ?? 'open' };
  if (opts.piStatus !== null) {
    const pi = { id: 'pi_1', status: opts.piStatus };
    if (opts.v20) {
      invoice.payments = { data: [{ payment: { payment_intent: pi } }] };
    } else {
      invoice.payment_intent = pi;
    }
  }
  return { status: opts.status, latest_invoice: invoice };
};

describe('classifyStripeReconcile', () => {
  it('paid + PI 無し → trial', () => {
    expect(classifyStripeReconcile(sub({ status: 'trialing', invoiceStatus: 'paid', piStatus: null }))).toBe('trial');
  });

  it('active + succeeded → clear', () => {
    expect(classifyStripeReconcile(sub({ status: 'active', piStatus: 'succeeded' }))).toBe('clear');
  });

  it('M1: 任意解約（canceled + PI succeeded + paid）→ canceled（succeeded に吸われない）', () => {
    expect(classifyStripeReconcile(sub({ status: 'canceled', invoiceStatus: 'paid', piStatus: 'succeeded' }))).toBe(
      'canceled',
    );
  });

  it('incomplete_expired → canceled', () => {
    expect(classifyStripeReconcile(sub({ status: 'incomplete_expired', piStatus: 'requires_payment_method' }))).toBe(
      'canceled',
    );
  });

  it('past_due + requires_payment_method → failed', () => {
    expect(classifyStripeReconcile(sub({ status: 'past_due', piStatus: 'requires_payment_method' }))).toBe('failed');
  });

  it('past_due + requires_action → action_required', () => {
    expect(classifyStripeReconcile(sub({ status: 'past_due', piStatus: 'requires_action' }))).toBe('action_required');
  });

  it('v20 の invoice.payments.data[].payment.payment_intent も解決する', () => {
    expect(
      classifyStripeReconcile(sub({ status: 'canceled', invoiceStatus: 'paid', piStatus: 'succeeded', v20: true })),
    ).toBe('canceled');
    expect(classifyStripeReconcile(sub({ status: 'past_due', piStatus: 'requires_payment_method', v20: true }))).toBe(
      'failed',
    );
  });

  it('active + not-yet-charged（processing 等）→ none', () => {
    expect(classifyStripeReconcile(sub({ status: 'active', piStatus: 'processing' }))).toBe('none');
  });

  it('M2: トライアル中解約（canceled + paid invoice + PI 無し）→ canceled（trial に吸われない）', () => {
    expect(classifyStripeReconcile(sub({ status: 'canceled', invoiceStatus: 'paid', piStatus: null }))).toBe(
      'canceled',
    );
  });

  it('M2: canceled で PI 未 expand（latest_invoice も無し）でも canceled', () => {
    expect(classifyStripeReconcile({ status: 'canceled' })).toBe('canceled');
  });

  it('m4: PI が id 文字列のみ（未 expand）— canceled は拾い、succeeded/dunning は none に落ちる', () => {
    // canceled は subStatus だけで判定 → canceled。
    expect(classifyStripeReconcile({ status: 'canceled', latest_invoice: { payment_intent: 'pi_x' } })).toBe(
      'canceled',
    );
    // dunning だが PI が id 文字列で status 不明 → none（consumer が expand すべき契約）。
    expect(classifyStripeReconcile({ status: 'past_due', latest_invoice: { payment_intent: 'pi_x' } })).toBe('none');
  });

  it('通常のトライアル（trialing + paid + PI 無し）は trial のまま', () => {
    expect(classifyStripeReconcile(sub({ status: 'trialing', invoiceStatus: 'paid', piStatus: null }))).toBe('trial');
  });

  it('非オブジェクト → none', () => {
    expect(classifyStripeReconcile(null)).toBe('none');
    expect(classifyStripeReconcile('x')).toBe('none');
  });
});
