import { describe, expect, it } from 'vitest';
import { authHeaders, registerFirebaseToken } from './auth';
import { configurableFake } from './configurable-fake';
import { FakeFirebaseVerifier } from './fakes';
import { fakeApiList, fakePaymentIntent, fakeStripeEvent } from './stripe-fixtures';

describe('authHeaders', () => {
  it('既定で x-amz-security-token + meta + content-type を組む', () => {
    expect(authHeaders('tok')).toEqual({
      'x-amz-security-token': 'tok',
      'x-amz-meta-version': '1.0.0',
      'x-amz-meta-uuid': 'test-uuid',
      'content-type': 'application/json',
    });
  });
  it('version/uuid を上書きできる', () => {
    const h = authHeaders('tok', { version: '0.0.0', uuid: 'u' });
    expect(h['x-amz-meta-version']).toBe('0.0.0');
    expect(h['x-amz-meta-uuid']).toBe('u');
  });
  it('contentType:null で content-type を付けない（GET 用）', () => {
    expect(authHeaders('tok', { contentType: null })['content-type']).toBeUndefined();
  });
});

describe('registerFirebaseToken', () => {
  it('fake に登録し、そのトークンが verifyIdToken で解決する', async () => {
    const fb = new FakeFirebaseVerifier();
    const token = registerFirebaseToken(fb, 'uid-1');
    expect(token).toBe('tok-uid-1');
    expect(await fb.verifyIdToken(token)).toMatchObject({ uid: 'uid-1' });
  });
  it('email など追加クレームを載せられる', async () => {
    const fb = new FakeFirebaseVerifier();
    const token = registerFirebaseToken(fb, 'uid-2', { email: 'a@b.c' }, 'custom-tok');
    expect(token).toBe('custom-tok');
    expect(await fb.verifyIdToken('custom-tok')).toMatchObject({ uid: 'uid-2', email: 'a@b.c' });
  });
});

describe('configurableFake', () => {
  interface Gw {
    a(): string;
    b(): string;
  }
  it('設定済みメソッドは動き、未設定メソッドは明示 throw する', () => {
    const gw = configurableFake<Gw>({ a: () => 'ok' }, 'FakeGw');
    expect(gw.a()).toBe('ok');
    expect(() => gw.b()).toThrow('FakeGw.b not configured');
  });

  it('then/catch/finally は undefined を返す（誤って await しても thenable 罠にならない）', async () => {
    const gw = configurableFake<Gw>({ a: () => 'ok' }, 'FakeGw');
    expect((gw as unknown as { then?: unknown }).then).toBeUndefined();
    // Promise.resolve(thenable) が then() を呼んで throw しないこと（解決値として素通り）。
    await expect(Promise.resolve(gw)).resolves.toBe(gw);
  });
});

describe('stripe fixtures', () => {
  it('fakePaymentIntent は既定 succeeded、over で上書き', () => {
    expect(fakePaymentIntent().status).toBe('succeeded');
    expect(fakePaymentIntent({ status: 'canceled' }).status).toBe('canceled');
  });
  it('fakeApiList は data を包む', () => {
    const list = fakeApiList([fakePaymentIntent(), fakePaymentIntent({ id: 'pi_2' })]);
    expect(list.object).toBe('list');
    expect(list.data).toHaveLength(2);
  });
  it('fakeStripeEvent は type と data.object を持つ', () => {
    const evt = fakeStripeEvent('payment_intent.succeeded', fakePaymentIntent());
    expect(evt.type).toBe('payment_intent.succeeded');
    expect((evt.data.object as { id: string }).id).toBe('pi_test_1');
  });
});
