import { describe, expect, it, vi } from 'vitest';
import { classifyGoogleSubscription, getGoogleSubscription, googleAccessToken } from './google.js';

const NOW = 1_720_000_000_000;
const PAST = '1719817200000';
const FUTURE = '4102444800000';

describe('classifyGoogleSubscription', () => {
  it('失効 かつ autoRenewing=false → canceled', () => {
    expect(classifyGoogleSubscription({ expiryTimeMillis: PAST, autoRenewing: false }, NOW).state).toBe('canceled');
  });

  it('失効 かつ cancelReason あり → canceled', () => {
    expect(classifyGoogleSubscription({ expiryTimeMillis: PAST, cancelReason: 0 }, NOW).state).toBe('canceled');
  });

  it('未失効 → active', () => {
    expect(classifyGoogleSubscription({ expiryTimeMillis: FUTURE, autoRenewing: true }, NOW).state).toBe('active');
  });

  it('410 エラー → gone', () => {
    expect(classifyGoogleSubscription({ error: { code: 410, message: 'expired' } }, NOW)).toEqual({
      state: 'gone',
      statusCode: 410,
    });
  });

  it('410 以外のエラー → unknown', () => {
    expect(classifyGoogleSubscription({ error: { code: 500 } }, NOW).state).toBe('unknown');
  });

  it('失効・autoRenewing=true・cancelReason 無し（account hold 等） → unknown', () => {
    expect(classifyGoogleSubscription({ expiryTimeMillis: PAST, autoRenewing: true }, NOW).state).toBe('unknown');
  });

  it('expiryTimeMillis 欠損・不正値は active にせず unknown', () => {
    expect(classifyGoogleSubscription({}, NOW).state).toBe('unknown');
    expect(classifyGoogleSubscription({ expiryTimeMillis: 'invalid' }, NOW).state).toBe('unknown');
  });
});

describe('googleAccessToken / getGoogleSubscription', () => {
  it('refresh_token を access_token に交換する', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ access_token: 'tok' }) });
    const tok = await googleAccessToken({ client_id: 'c', client_secret: 's', refresh_token: 'r' }, fetchImpl);
    expect(tok).toBe('tok');
    expect(fetchImpl.mock.calls[0][0]).toContain('accounts.google.com/o/oauth2/token');
  });

  it('access_token が無ければ throw（refresh token 失効を可視化）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ error: 'invalid_grant' }) });
    await expect(
      googleAccessToken({ client_id: 'c', client_secret: 's', refresh_token: 'r' }, fetchImpl),
    ).rejects.toThrow();
  });

  it('androidpublisher の URL を組み立て、token は Authorization ヘッダで送る（クエリに載せない）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ expiryTimeMillis: FUTURE }) });
    const res = await getGoogleSubscription({
      packageName: 'jp.rdlabo.app',
      subscriptionId: 'sub.standard',
      purchaseToken: 'ptok',
      accessToken: 'tok',
      fetchImpl: fetchImpl,
    });
    expect(res.expiryTimeMillis).toBe(FUTURE);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain(
      '/androidpublisher/v3/applications/jp.rdlabo.app/purchases/subscriptions/sub.standard/tokens/ptok',
    );
    expect(url).not.toContain('access_token=');
    const init = fetchImpl.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.authorization).toBe('Bearer tok');
  });
});
