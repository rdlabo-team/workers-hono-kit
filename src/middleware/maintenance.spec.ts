import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMaintenanceMiddleware,
  createMaintenanceWaitHandler,
  isMaintenanceEnabled,
  MAINTENANCE_BODY,
  MAINTENANCE_CODE,
  MAINTENANCE_WAIT_PATH,
} from './maintenance.js';

describe('isMaintenanceEnabled', () => {
  it('true only when MAINTENANCE is the string "1"', () => {
    expect(isMaintenanceEnabled({ MAINTENANCE: '1' })).toBe(true);
    expect(isMaintenanceEnabled({ MAINTENANCE: '0' })).toBe(false);
    expect(isMaintenanceEnabled({ MAINTENANCE: 'true' })).toBe(false);
    expect(isMaintenanceEnabled({})).toBe(false);
  });
});

describe('createMaintenanceMiddleware', () => {
  function buildApp(enabled: boolean, allowPaths?: readonly string[]) {
    const app = new Hono();
    let ranDownstream = false;
    app.use(
      '*',
      createMaintenanceMiddleware({
        isEnabled: () => enabled,
        allowPaths,
      }),
    );
    app.all('*', (c) => {
      ranDownstream = true;
      return c.json({ ok: true });
    });
    return {
      app,
      wasDownstreamRun: () => ranDownstream,
    };
  }

  it('passes through when maintenance is off', async () => {
    const { app, wasDownstreamRun } = buildApp(false);
    const res = await app.request('/api/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(wasDownstreamRun()).toBe(true);
  });

  it('returns 503 + MAINTENANCE body and skips downstream when on', async () => {
    const { app, wasDownstreamRun } = buildApp(true);
    const res = await app.request('/api/status');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(MAINTENANCE_BODY);
    expect(wasDownstreamRun()).toBe(false);
  });

  it('blocks GET and POST alike', async () => {
    const { app } = buildApp(true);
    const getRes = await app.request('/x');
    const postRes = await app.request('/x', { method: 'POST', body: '{}' });
    expect(getRes.status).toBe(503);
    expect(postRes.status).toBe(503);
    expect((await getRes.json()) as { code: string }).toMatchObject({ code: MAINTENANCE_CODE });
    expect((await postRes.json()) as { code: string }).toMatchObject({ code: MAINTENANCE_CODE });
  });

  it('serves wait SSE inside the middleware without running downstream', async () => {
    const { app, wasDownstreamRun } = buildApp(true);
    const res = await app.request(MAINTENANCE_WAIT_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(wasDownstreamRun()).toBe(false);
  });

  it('serves wait SSE even when maintenance is off (immediate ended)', async () => {
    const { app, wasDownstreamRun } = buildApp(false);
    const res = await app.request(MAINTENANCE_WAIT_PATH);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('event: ended\ndata: ended\n\n');
    expect(wasDownstreamRun()).toBe(false);
  });

  it('allowlists extra paths with next()', async () => {
    const app = new Hono();
    let ranDownstream = false;
    app.use(
      '*',
      createMaintenanceMiddleware({
        isEnabled: () => true,
        allowPaths: [MAINTENANCE_WAIT_PATH, '/health'],
      }),
    );
    app.get('/health', (c) => {
      ranDownstream = true;
      return c.json({ ok: true });
    });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(ranDownstream).toBe(true);
  });

  it('sets Retry-After when configured', async () => {
    const app = new Hono();
    app.use(
      '*',
      createMaintenanceMiddleware({
        isEnabled: () => true,
        retryAfterSeconds: 60,
      }),
    );
    app.get('/x', (c) => c.text('x'));
    const res = await app.request('/x');
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('60');
  });
});

describe('createMaintenanceWaitHandler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function readSse(res: Response): Promise<string> {
    return res.text();
  }

  it('emits ended immediately when maintenance is already off', async () => {
    const app = new Hono();
    app.get(
      MAINTENANCE_WAIT_PATH,
      createMaintenanceWaitHandler({
        isEnabled: () => false,
      }),
    );
    const res = await app.request(MAINTENANCE_WAIT_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await readSse(res)).toBe('event: ended\ndata: ended\n\n');
  });

  it('emits ping then ended after isEnabled flips to false', async () => {
    vi.useFakeTimers();
    let enabled = true;
    const app = new Hono();
    app.get(
      MAINTENANCE_WAIT_PATH,
      createMaintenanceWaitHandler({
        isEnabled: () => enabled,
        pingIntervalMs: 1_000,
      }),
    );

    const res = await app.request(MAINTENANCE_WAIT_PATH);
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const readMore = async (): Promise<boolean> => {
      // DOM ReadableStream typings are unresolved under this package's eslint project service.
      const result = (await reader.read()) as unknown as { done: boolean; value?: Uint8Array };
      if (!result.done && result.value) {
        buffer += decoder.decode(result.value, { stream: true });
      }
      return result.done;
    };

    // First tick → ping
    const pingWait = readMore();
    await vi.advanceTimersByTimeAsync(1_000);
    await pingWait;
    expect(buffer).toContain('event: ping');

    // Flip off → ended on next tick
    enabled = false;
    const endWait = readMore();
    await vi.advanceTimersByTimeAsync(1_000);
    await endWait;
    expect(buffer).toContain('event: ended\ndata: ended\n\n');
  });
});
