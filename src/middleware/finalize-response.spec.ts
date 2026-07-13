import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { finalizeResponse } from './finalize-response.js';

// hono/etag(weak) と同じ算法（SHA-1 の hex）を Node crypto で独立に再現して裏取りする。
function honoWeakEtag(body: string): string {
  const hash = createHash('sha1').update(body, 'utf8').digest('hex');
  return `W/"${hash}"`;
}

function buildApp() {
  const app = new Hono();
  app.use('*', finalizeResponse());
  app.get('/json', (c) => c.body('{"a":1}', 200, { 'content-type': 'application/json' }));
  app.get('/text', (c) => c.body('hello', 200, { 'content-type': 'text/plain' }));
  app.get('/204', (c) => c.body(null, 204, { 'content-type': 'application/json' }));
  app.get('/304', (c) => c.body(null, 304, { 'content-type': 'application/json' }));
  app.get('/sse', (c) => c.body('data: x\n\n', 200, { 'content-type': 'text/event-stream' }));
  app.get('/preset-etag', (c) => c.body('{"a":1}', 200, { 'content-type': 'application/json', etag: 'W/"keep-me"' }));
  return app;
}

describe('finalizeResponse', () => {
  it('JSON に weak ETag を付与し、content-type / body は変えない', async () => {
    const res = await buildApp().request('/json');
    // charset の書き換えはしない（Express parity を廃止）。
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('etag')).toBe(honoWeakEtag('{"a":1}'));
    expect(await res.text()).toBe('{"a":1}'); // body は不変
  });

  it('非 JSON（text/plain）でも ETag を付与する', async () => {
    const res = await buildApp().request('/text');
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(res.headers.get('etag')).toBe(honoWeakEtag('hello'));
  });

  it('body が無い（null）レスポンスには ETag を付けない', async () => {
    const app = new Hono();
    app.use('*', finalizeResponse());
    app.get('/no-body', (c) => c.body(null, 200, { 'content-type': 'application/json' }));
    const res = await app.request('/no-body');
    expect(res.headers.get('etag')).toBeNull();
  });

  it('204 / 304 では ETag を付けない', async () => {
    const r204 = await buildApp().request('/204');
    const r304 = await buildApp().request('/304');
    expect(r204.headers.get('etag')).toBeNull();
    expect(r304.headers.get('etag')).toBeNull();
  });

  it('SSE（text/event-stream）は一切触らない', async () => {
    const res = await buildApp().request('/sse');
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('etag')).toBeNull();
  });

  it('既存の ETag は尊重して上書きしない', async () => {
    const res = await buildApp().request('/preset-etag');
    expect(res.headers.get('etag')).toBe('W/"keep-me"');
  });

  it('If-None-Match が一致すると 304 を返す（hono/etag 由来の標準挙動）', async () => {
    const res = await buildApp().request('/json', { headers: { 'If-None-Match': honoWeakEtag('{"a":1}') } });
    expect(res.status).toBe(304);
  });
});
