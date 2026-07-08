import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createValidate } from './validation.js';
import type { SentryLike } from './validation.js';

function fakeSentry() {
  const tags: Record<string, string> = {};
  const contexts: Record<string, unknown> = {};
  const captured: unknown[] = [];
  const sentry: SentryLike = {
    withScope(cb) {
      cb({
        setTag: (k, v) => void (tags[k] = v),
        setContext: (k, v) => void (contexts[k] = v),
      });
    },
    captureException: (e) => void captured.push(e),
  };
  return { sentry, tags, contexts, captured };
}

const schema = z.object({ name: z.string() });

describe('createValidate({ sentry })', () => {
  it('検証成功時は Sentry に通報しない', async () => {
    const { sentry, captured } = fakeSentry();
    const validate = createValidate({ sentry });
    const app = new Hono().post('/', validate('json', schema), (c) => c.json({ ok: true }));

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(0);
  });

  it('検証失敗時は NestJS 同形 400 を返しつつ Sentry に dto_validation で通報する', async () => {
    const { sentry, tags, contexts, captured } = fakeSentry();
    const validate = createValidate({ sentry });
    const app = new Hono().post('/', validate('json', schema), (c) => c.json({ ok: true }));

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    expect(tags['error.type']).toBe('dto_validation');
    expect(contexts.validation).toMatchObject({ errorCount: 1 });
    expect(captured).toHaveLength(1);
  });

  it('Sentry が throw しても検証レスポンスは変わらない（通報は握り潰す）', async () => {
    const sentry: SentryLike = {
      withScope: () => {
        throw new Error('sentry down');
      },
      captureException: vi.fn(),
    };
    const validate = createValidate({ sentry });
    const app = new Hono().post('/', validate('json', schema), (c) => c.json({ ok: true }));

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    });
    expect(res.status).toBe(400);
  });
});
