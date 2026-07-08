import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createContainerRuntime } from './middleware.js';

describe('createContainerRuntime', () => {
  it('injects override container without opening connections', async () => {
    const createContainer = vi.fn();
    const { middleware } = createContainerRuntime({
      hyperdrives: () => ({ primary: {} as never, replica: {} as never }),
      createContainer,
    });

    const stub = { id: 'test' };
    const app = new Hono<{ Variables: { container: typeof stub } }>();
    app.use('*', middleware({ container: stub }));
    app.get('/', (c) => c.json(c.get('container')));

    const res = await app.request('http://localhost/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(stub);
    expect(createContainer).not.toHaveBeenCalled();
  });
});
