import { describe, expect, it, vi } from 'vitest';
import { classifyAppleRenewal, verifyAppleReceipt } from './apple.js';

const NOW = 1_720_000_000_000; // 2024-07-03
const PAST = '1719817200000'; // 2024-07-01
const FUTURE = '4102444800000'; // 2100

const receipt = (opts: { expiresMs: string; billingRetry?: boolean; autoRenewOff?: boolean }) => ({
  status: 0,
  environment: 'Production',
  latest_receipt_info: [{ original_transaction_id: 'otx1', expires_date_ms: opts.expiresMs }],
  pending_renewal_info: [
    {
      is_in_billing_retry_period: opts.billingRetry ? '1' : '0',
      auto_renew_status: opts.autoRenewOff ? '0' : '1',
    },
  ],
});

describe('classifyAppleRenewal', () => {
  it('billing retry → billing_retry（otx/expires 付き）', () => {
    expect(classifyAppleRenewal(receipt({ expiresMs: PAST, billingRetry: true }), NOW)).toEqual({
      state: 'billing_retry',
      originalTransactionId: 'otx1',
      expiresDateMs: PAST,
    });
  });

  it('auto_renew off かつ失効 → lapsed', () => {
    expect(classifyAppleRenewal(receipt({ expiresMs: PAST, autoRenewOff: true }), NOW).state).toBe('lapsed');
  });

  it('未失効 → active', () => {
    expect(classifyAppleRenewal(receipt({ expiresMs: FUTURE }), NOW).state).toBe('active');
  });

  it('失効・auto_renew on・非リトライ → unknown', () => {
    expect(classifyAppleRenewal(receipt({ expiresMs: PAST }), NOW).state).toBe('unknown');
  });

  it('latest_receipt_info 無し → unknown', () => {
    expect(classifyAppleRenewal({ status: 0 }, NOW).state).toBe('unknown');
  });

  it('最新（max expires_date_ms）を採用する（配列順に依らない）', () => {
    const v = {
      latest_receipt_info: [
        { original_transaction_id: 'otx1', expires_date_ms: PAST },
        { original_transaction_id: 'otx1', expires_date_ms: FUTURE },
      ],
      pending_renewal_info: [{ auto_renew_status: '1' }],
    };
    expect(classifyAppleRenewal(v, NOW)).toMatchObject({ state: 'active', expiresDateMs: FUTURE });
  });

  it('M1: expires_date_ms 欠損エントリが先頭にあっても NaN 汚染で誤って active にしない', () => {
    const v = {
      latest_receipt_info: [
        { original_transaction_id: 'otx1' }, // 消耗型など expires 欠損（先頭）
        { original_transaction_id: 'otx1', expires_date_ms: PAST },
      ],
      pending_renewal_info: [{ auto_renew_status: '0' }],
    };
    // 欠損行を除外し、有効な PAST を最新として採用 → lapsed（旧実装は NaN で active に誤判定）。
    expect(classifyAppleRenewal(v, NOW)).toMatchObject({ state: 'lapsed', expiresDateMs: PAST });
  });

  it('M4: pending_renewal_info は latest の original_transaction_id に一致する entry を選ぶ', () => {
    const v = {
      latest_receipt_info: [{ original_transaction_id: 'otxB', expires_date_ms: PAST }],
      pending_renewal_info: [
        { original_transaction_id: 'otxA', is_in_billing_retry_period: '1' }, // 別商品
        { original_transaction_id: 'otxB', auto_renew_status: '0' }, // latest と一致
      ],
    };
    // otxB の pending を読む → lapsed（otxA の billing_retry を誤読しない）。
    expect(classifyAppleRenewal(v, NOW).state).toBe('lapsed');
  });
});

describe('verifyAppleReceipt', () => {
  it('production が status=0 ならそれを返す（sandbox は叩かない）', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ json: () => Promise.resolve({ status: 0, environment: 'Production' }) });
    const res = await verifyAppleReceipt('r', { password: 'p', fetchImpl: fetchImpl });
    expect(res?.environment).toBe('Production');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('buy.itunes.apple.com');
  });

  it('production が非0なら sandbox にフォールバックする', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ status: 21007 }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ status: 0, environment: 'Sandbox' }) });
    const res = await verifyAppleReceipt('r', { password: 'p', fetchImpl: fetchImpl });
    expect(res?.environment).toBe('Sandbox');
    expect(fetchImpl.mock.calls[1][0]).toContain('sandbox.itunes.apple.com');
  });

  it('両方非0なら null（無効レシート）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ status: 21002 }) });
    expect(await verifyAppleReceipt('r', { password: 'p', fetchImpl: fetchImpl })).toBeNull();
  });
});
