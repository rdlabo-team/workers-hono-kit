import { describe, expect, it } from 'vitest';
import {
  extractStripeFailureReason,
  parsePaymentFailure,
  PaymentDeclinedError,
  serializePaymentFailure,
  stripeFailureMessageJa,
  toPaymentDeclinedError,
} from './failure.js';
import type { PaymentFailureRecord } from './failure.js';

describe('extractStripeFailureReason', () => {
  it('PaymentIntent の last_payment_error から抽出する', () => {
    const paymentIntent = {
      object: 'payment_intent',
      id: 'pi_1',
      status: 'requires_payment_method',
      last_payment_error: {
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        message: 'Your card has insufficient funds.',
      },
    };
    expect(extractStripeFailureReason(paymentIntent)).toEqual({
      code: 'card_declined',
      declineCode: 'insufficient_funds',
      message: 'Your card has insufficient funds.',
      paymentIntentId: 'pi_1',
      invoiceId: undefined,
      subscriptionId: undefined,
    });
  });

  it('Invoice + 展開済み PaymentIntent（ids も拾う）', () => {
    const invoice = {
      object: 'invoice',
      id: 'in_1',
      subscription: 'sub_1',
      payment_intent: {
        object: 'payment_intent',
        id: 'pi_2',
        last_payment_error: { code: 'expired_card', decline_code: 'expired_card', message: 'expired' },
      },
    };
    expect(extractStripeFailureReason(invoice)).toMatchObject({
      declineCode: 'expired_card',
      paymentIntentId: 'pi_2',
      invoiceId: 'in_1',
      subscriptionId: 'sub_1',
    });
  });

  it('{ paymentIntent, invoice } コンテナ形式を受け付ける', () => {
    const reason = extractStripeFailureReason({
      invoice: { object: 'invoice', id: 'in_9', subscription: { id: 'sub_9' } },
      paymentIntent: { object: 'payment_intent', id: 'pi_9', last_payment_error: { decline_code: 'lost_card' } },
    });
    expect(reason).toMatchObject({
      declineCode: 'lost_card',
      paymentIntentId: 'pi_9',
      invoiceId: 'in_9',
      subscriptionId: 'sub_9',
    });
  });

  it('SCA（requires_action, decline なし）は authentication_required を補う', () => {
    const invoice = {
      object: 'invoice',
      id: 'in_2',
      payment_intent: { object: 'payment_intent', id: 'pi_3', status: 'requires_action', last_payment_error: null },
    };
    expect(extractStripeFailureReason(invoice)).toMatchObject({
      code: 'authentication_required',
      paymentIntentId: 'pi_3',
    });
  });

  it('throw された StripeCardError から抽出する（payment_intent は id 文字列）', () => {
    const err = {
      type: 'StripeCardError',
      code: 'card_declined',
      decline_code: 'do_not_honor',
      message: 'declined',
      payment_intent: 'pi_err',
    };
    expect(extractStripeFailureReason(err)).toMatchObject({ declineCode: 'do_not_honor', paymentIntentId: 'pi_err' });
  });

  it('理由が一切拾えなければ null', () => {
    expect(extractStripeFailureReason({ object: 'invoice', id: undefined })).toBeNull();
    expect(extractStripeFailureReason(null)).toBeNull();
    expect(extractStripeFailureReason('nope')).toBeNull();
  });
});

describe('stripeFailureMessageJa', () => {
  it('decline_code を最優先する', () => {
    expect(stripeFailureMessageJa({ code: 'card_declined', declineCode: 'insufficient_funds' })).toContain('残高不足');
  });

  it('decline_code が無ければ code を使う', () => {
    expect(stripeFailureMessageJa({ code: 'authentication_required' })).toContain('3Dセキュア');
  });

  it('詐欺系 decline_code は総称文言でマスクする', () => {
    const masked = stripeFailureMessageJa({ declineCode: 'stolen_card' });
    expect(masked).not.toContain('盗');
    expect(masked).toBe(stripeFailureMessageJa({ declineCode: 'lost_card' }));
  });

  it('null / 未知は汎用文言', () => {
    expect(stripeFailureMessageJa(null)).toContain('前回のカード決済に失敗');
    expect(stripeFailureMessageJa({ declineCode: 'some_new_code' })).toContain('前回のカード決済に失敗');
  });
});

describe('serialize / parse payment failure', () => {
  const record: PaymentFailureRecord = {
    reason: { code: 'card_declined', declineCode: 'insufficient_funds', message: 'x' },
    source: 'webhook.invoice.payment_failed',
    occurredAt: '2026-07-10T00:00:00.000Z',
  };

  it('round-trip で一致する', () => {
    expect(parsePaymentFailure(serializePaymentFailure(record))).toEqual(record);
  });

  it('IAP reason のstatus code・更新状態もround-tripで保持する', () => {
    const iapRecord: PaymentFailureRecord = {
      reason: {
        code: 'billing_retry',
        statusCode: 0,
        billingRetryStatus: '1',
        autoRenewStatus: '1',
      },
    };
    expect(parsePaymentFailure(serializePaymentFailure(iapRecord))).toEqual(iapRecord);
  });

  it('空 / 不正 JSON は null', () => {
    expect(parsePaymentFailure(null)).toBeNull();
    expect(parsePaymentFailure('')).toBeNull();
    expect(parsePaymentFailure('{not json')).toBeNull();
    expect(parsePaymentFailure('{"foo":1}')).toBeNull();
  });
});

describe('PaymentDeclinedError / toPaymentDeclinedError', () => {
  it('body に日本語 message と code を持ち、既定 status は 400', () => {
    const err = new PaymentDeclinedError({ code: 'card_declined', declineCode: 'insufficient_funds' });
    expect(err.status).toBe(400);
    expect(err.body.message).toContain('残高不足');
    expect(err.body.declineCode).toBe('insufficient_funds');
    expect(err.body.statusCode).toBe(400);
  });

  it('StripeCardError を変換する', () => {
    const converted = toPaymentDeclinedError({
      type: 'StripeCardError',
      code: 'card_declined',
      decline_code: 'expired_card',
    });
    expect(converted).toBeInstanceOf(PaymentDeclinedError);
    expect(converted?.body.message).toContain('有効期限');
  });

  it('カード起因でないエラーは null（呼び出し側で再 throw させる）', () => {
    expect(toPaymentDeclinedError({ type: 'StripeInvalidRequestError', code: 'resource_missing' })).toBeNull();
    expect(toPaymentDeclinedError(new Error('boom'))).toBeNull();
    expect(toPaymentDeclinedError(null)).toBeNull();
  });
});
