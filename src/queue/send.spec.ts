import { describe, expect, it, vi } from 'vitest';
import { sendInChunks } from './send.js';
import type { QueueLike, QueueSendMessage } from './send.js';

/**
 * Fake producer binding that records every `sendBatch` call so tests can assert both the number of
 * subrequests (batches) and the messages enqueued.
 */
function createFakeQueue<Body>(): QueueLike<Body> & { batches: QueueSendMessage<Body>[][] } {
  const batches: QueueSendMessage<Body>[][] = [];
  return {
    batches,
    sendBatch: vi.fn(async (messages: Iterable<QueueSendMessage<Body>>) => {
      batches.push([...messages]);
    }),
  };
}

describe('sendInChunks', () => {
  it('空配列は何も送らず 0 を返す', async () => {
    const queue = createFakeQueue<number>();
    const batches = await sendInChunks(queue, []);
    expect(batches).toBe(0);
    expect(queue.sendBatch).not.toHaveBeenCalled();
  });

  it('各要素を body に包んで 1 バッチで送る', async () => {
    const queue = createFakeQueue<number>();
    const batches = await sendInChunks(queue, [1, 2, 3]);
    expect(batches).toBe(1);
    expect(queue.batches).toEqual([[{ body: 1 }, { body: 2 }, { body: 3 }]]);
  });

  it('subrequest 数は ceil(N / chunkSize) に bound され、件数に線形依存しない', async () => {
    const queue = createFakeQueue<number>();
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const batches = await sendInChunks(queue, items); // default chunkSize = 100
    expect(batches).toBe(10);
    expect(queue.sendBatch).toHaveBeenCalledTimes(10);
    // 全メッセージが失われず投入されている
    expect(queue.batches.flat()).toHaveLength(1000);
  });

  it('chunkSize を指定できる', async () => {
    const queue = createFakeQueue<number>();
    const batches = await sendInChunks(queue, [1, 2, 3, 4, 5], { chunkSize: 2 });
    expect(batches).toBe(3);
    expect(queue.batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it('chunkSize は Queues 上限 100 にクランプされる', async () => {
    const queue = createFakeQueue<number>();
    const items = Array.from({ length: 250 }, (_, i) => i);
    const batches = await sendInChunks(queue, items, { chunkSize: 10_000 });
    expect(batches).toBe(3); // 100 + 100 + 50
    expect(queue.batches.every((b) => b.length <= 100)).toBe(true);
  });

  it('chunkSize < 1 は 1 にクランプされる', async () => {
    const queue = createFakeQueue<number>();
    const batches = await sendInChunks(queue, [1, 2, 3], { chunkSize: 0 });
    expect(batches).toBe(3);
    expect(queue.batches.map((b) => b.length)).toEqual([1, 1, 1]);
  });
});
