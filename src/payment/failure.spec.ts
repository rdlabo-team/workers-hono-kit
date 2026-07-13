import { describe, expect, it } from 'vitest';
import { iapFailureKey, paymentFailureMessageJa, UNRESOLVED_PAYMENT_STATUSES } from './failure.js';

describe('paymentFailureMessageJa', () => {
  it('canceled は解約・再登録の文言（type/reason に依らない）', () => {
    expect(paymentFailureMessageJa({ status: 'canceled' })).toContain('解約');
    expect(paymentFailureMessageJa({ status: 'canceled', type: 'ios' })).toContain('再度ご登録');
  });

  it('iOS の failed は App Store 更新導線', () => {
    expect(paymentFailureMessageJa({ status: 'failed', type: 'ios' })).toContain('App Store');
  });

  it('Android の failed は Google Play 更新導線', () => {
    expect(paymentFailureMessageJa({ status: 'failed', type: 'android' })).toContain('Google Play');
  });

  it('stripe の failed は decline_code から stripeFailureMessageJa を使う', () => {
    expect(
      paymentFailureMessageJa({ status: 'failed', type: 'stripe', reason: { declineCode: 'expired_card' } }),
    ).toContain('有効期限');
  });

  it('reason 無し/未知は汎用文言にフォールバック', () => {
    expect(paymentFailureMessageJa({ status: 'failed' })).toContain('カード');
  });

  it('action_required は SCA 認証文言（stripe reason 経由）', () => {
    expect(
      paymentFailureMessageJa({
        status: 'action_required',
        type: 'stripe',
        reason: { code: 'authentication_required' },
      }),
    ).toContain('3Dセキュア');
  });
});

describe('iapFailureKey', () => {
  it('iOS はtype接頭辞なしのサイクル固有ID（otx:expires_date_ms）', () => {
    expect(iapFailureKey({ platform: 'ios', originalTransactionId: 'otx1', expiresDateMs: '1719817200000' })).toBe(
      'otx1:1719817200000',
    );
  });

  it('Android は orderId をそのまま返す', () => {
    expect(iapFailureKey({ platform: 'android', orderId: 'GPA.1' })).toBe('GPA.1');
  });
});

describe('UNRESOLVED_PAYMENT_STATUSES', () => {
  it('resolved を含まない failed/action_required/canceled の集合', () => {
    expect([...UNRESOLVED_PAYMENT_STATUSES]).toEqual(['failed', 'action_required', 'canceled']);
    expect(UNRESOLVED_PAYMENT_STATUSES).not.toContain('resolved');
  });
});
