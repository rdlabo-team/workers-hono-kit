import { describe, expect, it } from 'vitest';
import { normalizeTrailingSlash } from './trailing-slash.js';

describe('normalizeTrailingSlash', () => {
  it('末尾スラッシュを除去する（GET）', () => {
    const req = normalizeTrailingSlash(new Request('https://api.example.com/functions/timeline/?page=0'));
    const url = new URL(req.url);
    expect(url.pathname).toBe('/functions/timeline');
    expect(url.search).toBe('?page=0');
    expect(req.method).toBe('GET');
  });

  it('メソッドと body を維持する（POST は 301 にしない）', async () => {
    const req = normalizeTrailingSlash(
      new Request('https://api.example.com/user/device/', { method: 'POST', body: JSON.stringify({ a: 1 }), headers: { 'content-type': 'application/json' } }),
    );
    expect(new URL(req.url).pathname).toBe('/user/device');
    expect(req.method).toBe('POST');
    expect(await req.json()).toEqual({ a: 1 });
  });

  it('末尾スラッシュが無ければ同一 request をそのまま返す', () => {
    const original = new Request('https://api.example.com/functions/timeline?page=0');
    expect(normalizeTrailingSlash(original)).toBe(original);
  });

  it('ルート `/` は変更しない（同一 request）', () => {
    const original = new Request('https://api.example.com/');
    expect(normalizeTrailingSlash(original)).toBe(original);
  });

  it('連続する末尾スラッシュも全て除去する', () => {
    const req = normalizeTrailingSlash(new Request('https://api.example.com/functions/talk///'));
    expect(new URL(req.url).pathname).toBe('/functions/talk');
  });
});
