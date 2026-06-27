import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { createStripeClient, verifyStripeWebhook } from './client';

/** Stripe-Signature ヘッダを生成（scheme: `t=<ts>,v1=HMAC-SHA256(secret, "<ts>.<payload>")`）。 */
async function stripeSignatureHeader(payload: string, secret: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

describe('createStripeClient', () => {
  it('secret 未設定で throw する', () => {
    expect(() => createStripeClient('')).toThrow('Stripe secret is not set');
  });

  it('Stripe インスタンスを返す（fetch HttpClient 使用）', () => {
    expect(createStripeClient('sk_test_x')).toBeInstanceOf(Stripe);
  });

  it('apiVersion を渡しても Stripe インスタンスを構成できる', () => {
    expect(createStripeClient('sk_test_x', { apiVersion: '2024-04-10' })).toBeInstanceOf(Stripe);
  });
});

describe('verifyStripeWebhook', () => {
  const apiKey = 'sk_test_dummy';
  const webhookSecret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_123', type: 'payment_intent.succeeded', data: { object: {} } });

  it('webhookSecret 未設定で throw する', () => {
    expect(() => verifyStripeWebhook(apiKey, '', payload, 'sig')).toThrow('Stripe webhook secret is not set');
  });

  it('正しい署名のイベントを検証して返す（SubtleCrypto 経路）', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = await stripeSignatureHeader(payload, webhookSecret, ts);
    const event = await verifyStripeWebhook(apiKey, webhookSecret, payload, sig);
    expect(event.id).toBe('evt_123');
    expect(event.type).toBe('payment_intent.succeeded');
  });

  it('改ざんされた payload は検証に失敗する', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = await stripeSignatureHeader(payload, webhookSecret, ts);
    const tampered = payload.replace('evt_123', 'evt_evil');
    await expect(verifyStripeWebhook(apiKey, webhookSecret, tampered, sig)).rejects.toThrow();
  });

  it('異なる secret で署名されたものは検証に失敗する', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const sigWithWrongSecret = await stripeSignatureHeader(payload, 'whsec_wrong_secret', ts);
    await expect(verifyStripeWebhook(apiKey, webhookSecret, payload, sigWithWrongSecret)).rejects.toThrow();
  });
});
