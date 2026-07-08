import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createHttpErrorHandler } from '../http/http-error.js';
import { createAuthMiddleware } from './auth.js';
import type { AuthMiddlewareOptions } from './auth.js';

interface Decoded {
  uid: string;
}

interface TestEnv {
  Variables: {
    userId?: number;
    decodedToken?: Decoded;
    appInfo?: { version: string | null; uuid: string | null };
  };
}

const baseOptions: AuthMiddlewareOptions<TestEnv, Decoded, number> = {
  verify: async (token) => {
    if (token !== 'good') {
      throw new Error('invalid token');
    }
    return { uid: 'u1' };
  },
  resolveUserId: async () => 42,
  setContext: (c, { verified, appInfo, userId }) => {
    c.set('userId', userId);
    c.set('decodedToken', verified);
    c.set('appInfo', appInfo);
  },
};

function appWith(options: AuthMiddlewareOptions<TestEnv, Decoded, number>) {
  const app = new Hono<TestEnv>();
  app.onError(createHttpErrorHandler());
  app.use('/guarded', createAuthMiddleware(options));
  app.get('/guarded', (c) =>
    c.json({
      userId: c.get('userId') ?? null,
      decoded: c.get('decodedToken') ?? null,
      appInfo: c.get('appInfo') ?? null,
    }),
  );
  return app;
}

const goodHeaders = {
  'x-amz-security-token': 'good',
  'x-amz-meta-version': '1.0.0',
  'x-amz-meta-uuid': 'abc',
};

describe('createAuthMiddleware', () => {
  it('検証成功で userId / record / appInfo を c.var にセットする', async () => {
    const res = await appWith(baseOptions).request('/guarded', { headers: goodHeaders });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: 42,
      decoded: { uid: 'u1' },
      appInfo: { version: '1.0.0', uuid: 'abc' },
    });
  });

  it('検証失敗は既定で 403 HTTPException を throw する（onError が Nest body を描く）', async () => {
    const res = await appWith(baseOptions).request('/guarded', { headers: { 'x-amz-security-token': 'bad' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' });
  });

  it('resolveUserId の reject も失敗として扱う（create-on-miss 失敗 → 既定 403）', async () => {
    const res = await appWith({
      ...baseOptions,
      resolveUserId: async () => {
        throw new Error('user provisioning failed');
      },
    }).request('/guarded', { headers: goodHeaders });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' });
  });

  it('resolveUserId は検証済み record と appInfo を受け取る', async () => {
    let received: { verified: Decoded; appInfo: unknown } | undefined;
    await appWith({
      ...baseOptions,
      resolveUserId: async (verified, _c, appInfo) => {
        received = { verified, appInfo };
        return 7;
      },
    }).request('/guarded', { headers: goodHeaders });
    expect(received).toEqual({ verified: { uid: 'u1' }, appInfo: { version: '1.0.0', uuid: 'abc' } });
  });

  it('onFailure を渡すと throw ではなく return 形のレスポンスにできる（winecode 互換）', async () => {
    const FORBIDDEN_BODY = { message: 'Forbidden resource', error: 'Forbidden', statusCode: 403 } as const;
    const res = await appWith({
      ...baseOptions,
      onFailure: (_e, c) => c.json(FORBIDDEN_BODY, 403),
    }).request('/guarded', { headers: {} });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(FORBIDDEN_BODY);
  });

  it('resolveUserId を省くと token-only（userId 解決なし）になる', async () => {
    const res = await appWith({
      verify: baseOptions.verify,
      setContext: (c, { verified }) => {
        c.set('decodedToken', verified);
      },
    }).request('/guarded', { headers: goodHeaders });
    expect(await res.json()).toEqual({ userId: null, decoded: { uid: 'u1' }, appInfo: null });
  });

  it('failureStatus を上書きできる（token guard の 401）', async () => {
    const res = await appWith({
      verify: baseOptions.verify,
      setContext: (c, { verified }) => {
        c.set('decodedToken', verified);
      },
      failureStatus: 401,
      failureMessage: 'Unauthorized',
    }).request('/guarded', { headers: {} });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ statusCode: 401, message: 'Unauthorized' });
  });

  it('tokenHeader を上書きでき、既定ヘッダは参照しない', async () => {
    const options: AuthMiddlewareOptions<TestEnv, Decoded, number> = { ...baseOptions, tokenHeader: 'authorization' };
    const ok = await appWith(options).request('/guarded', { headers: { authorization: 'good' } });
    expect(ok.status).toBe(200);

    // 既定ヘッダに入れても、tokenHeader を変えた以上は読まれず失敗する。
    const miss = await appWith(options).request('/guarded', { headers: { 'x-amz-security-token': 'good' } });
    expect(miss.status).toBe(403);
  });
});
