import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { describe, expect, it, vi } from 'vitest';
import { createHttpErrorHandler, notFoundHandler } from './http-error.js';
import type { HttpErrorHandlerOptions } from './http-error.js';

function buildApp(options?: HttpErrorHandlerOptions) {
  const app = new Hono();
  app.onError(createHttpErrorHandler(options));
  app.notFound(notFoundHandler);
  app.get('/forbidden', () => {
    throw new HTTPException(403, { message: 'Forbidden resource' });
  });
  app.get('/unauthorized', () => {
    throw new HTTPException(401, { message: 'Unauthorized' });
  });
  app.get('/teapot', () => {
    throw new HTTPException(418, { message: "I'm a teapot" });
  });
  app.get('/boom', () => {
    throw new Error('boom');
  });
  return app;
}

describe('createHttpErrorHandler', () => {
  it('非 bare の HTTPException を標準 error body にマップする', async () => {
    const res = await buildApp().request('/forbidden');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      statusCode: 403,
      message: 'Forbidden resource',
      error: 'Forbidden',
    });
  });

  it('401 は error フィールドを持たない', async () => {
    const res = await buildApp().request('/unauthorized');
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"statusCode":401,"message":"Unauthorized"}');
  });

  it('reason phrase が無い status は bare body（statusCode, message のみ）', async () => {
    const res = await buildApp().request('/teapot');
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ statusCode: 418, message: "I'm a teapot" });
  });

  it('非 HTTPException は onUnhandledError 通報後に 500 を返す', async () => {
    const onUnhandledError = vi.fn();
    const res = await buildApp({ onUnhandledError }).request('/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(onUnhandledError).toHaveBeenCalledOnce();
    expect((onUnhandledError.mock.calls[0][0] as Error).message).toBe('boom');
  });

  it('通報フックが throw してもエラーレスポンスは変わらない', async () => {
    const onUnhandledError = () => {
      throw new Error('reporter exploded');
    };
    const res = await buildApp({ onUnhandledError }).request('/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ statusCode: 500, message: 'Internal server error' });
  });

  it('カスタム isHttpError と body 脱出口（winecode HttpError 相当）を verbatim で返す', async () => {
    class HttpError extends Error {
      constructor(
        readonly status: ContentfulStatusCode,
        message?: string,
        readonly body?: unknown,
      ) {
        super(message);
      }
    }
    const app = new Hono();
    app.onError(createHttpErrorHandler({ isHttpError: (e): e is HttpError => e instanceof HttpError }));
    app.get('/forbidden', () => {
      throw new HttpError(403, 'Forbidden resource');
    });
    app.get('/login-401', () => {
      throw new HttpError(401, 'x', { message: 'Unauthorized', statusCode: 401 });
    });

    const mapped = await app.request('/forbidden');
    expect(mapped.status).toBe(403);
    expect(await mapped.json()).toEqual({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' });

    const verbatim = await app.request('/login-401');
    expect(verbatim.status).toBe(401);
    expect(await verbatim.json()).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('notFoundHandler', () => {
  it('既定の 404 body（Cannot METHOD path）を返す', async () => {
    const res = await buildApp().request('/does/not/exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      message: 'Cannot GET /does/not/exist',
      error: 'Not Found',
      statusCode: 404,
    });
  });

  it('メソッドとパスを反映する', async () => {
    const res = await buildApp().request('/missing', { method: 'POST' });
    expect(await res.json()).toMatchObject({ message: 'Cannot POST /missing' });
  });
});
