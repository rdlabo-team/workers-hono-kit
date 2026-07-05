import { describe, expect, it } from 'vitest';
import { KVCache } from '../cache/kv-cache.js';
import { sendInChunks } from '../queue/send.js';
import { fakeKv, fakeQueue } from './workers-bindings.js';

describe('fakeQueue', () => {
  it('sendBatch は sent と batchCount を記録する', async () => {
    const queue = fakeQueue<number>();
    await queue.sendBatch([{ body: 1 }, { body: 2 }]);
    expect(queue.sent).toEqual([1, 2]);
    expect(queue.batchCount).toBe(1);
  });

  it('send は sent に追加する（batchCount は増えない）', async () => {
    const queue = fakeQueue<string>();
    await queue.send('a');
    expect(queue.sent).toEqual(['a']);
    expect(queue.batchCount).toBe(0);
  });

  it('sendInChunks と組み合わせて subrequest 数を検証できる', async () => {
    const queue = fakeQueue<number>();
    const batches = await sendInChunks(queue, Array.from({ length: 250 }, (_, i) => i));
    expect(batches).toBe(3);
    expect(queue.batchCount).toBe(3);
    expect(queue.sent).toHaveLength(250);
  });
});

describe('fakeKv', () => {
  it('get / put / delete が in-memory で動く', async () => {
    const kv = fakeKv();
    await kv.put('k', 'v');
    await expect(kv.get('k')).resolves.toBe('v');
    await kv.delete('k');
    await expect(kv.get('k')).resolves.toBeNull();
  });

  it('KVCache の backing store として使える', async () => {
    const cache = new KVCache(fakeKv(), { appName: 'test' });
    await cache.set('users', 'profile', 1, { name: 'alice' });
    await expect(cache.get<{ name: string }>('users', 'profile', 1)).resolves.toEqual({ name: 'alice' });
  });
});
