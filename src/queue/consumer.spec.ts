import { describe, expect, it, vi } from 'vitest';
import { processBatch } from './consumer.js';
import type { MessageBatchLike, QueueMessageLike } from './consumer.js';

/**
 * Build a fake message whose `ack`/`retry` are spies.
 */
function createMessage<Body>(id: string, body: Body): QueueMessageLike<Body> {
  return {
    id,
    attempts: 1,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function createBatch<Body>(messages: QueueMessageLike<Body>[], queue = 'test-queue'): MessageBatchLike<Body> {
  return { queue, messages };
}

describe('processBatch', () => {
  it('全メッセージ成功時は各 ack、retry なし', async () => {
    const messages = [createMessage('a', 1), createMessage('b', 2)];
    const handler = vi.fn(async () => undefined);
    const result = await processBatch(createBatch(messages), handler);

    expect(result).toEqual({ processed: 2, failed: 0 });
    expect(handler).toHaveBeenCalledTimes(2);
    for (const m of messages) {
      expect(m.ack).toHaveBeenCalledOnce();
      expect(m.retry).not.toHaveBeenCalled();
    }
  });

  it('handler は body とメッセージを受け取る', async () => {
    const message = createMessage('a', { userId: 42 });
    const handler = vi.fn(async () => undefined);
    await processBatch(createBatch([message]), handler);
    expect(handler).toHaveBeenCalledWith({ userId: 42 }, message);
  });

  it('1 件の失敗は他に波及せず、当該のみ retry される', async () => {
    const messages = [createMessage('a', 1), createMessage('b', 2), createMessage('c', 3)];
    const onError = vi.fn();
    const handler = vi.fn(async (body: number) => {
      if (body === 2) {
        throw new Error('boom');
      }
    });
    const result = await processBatch(createBatch(messages), handler, { onError });

    expect(result).toEqual({ processed: 2, failed: 1 });
    expect(messages[0].ack).toHaveBeenCalledOnce();
    expect(messages[1].ack).not.toHaveBeenCalled();
    expect(messages[1].retry).toHaveBeenCalledOnce();
    expect(messages[2].ack).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][1]).toBe(messages[1]);
  });

  it('retryDelaySeconds を retry に渡す', async () => {
    const message = createMessage('a', 1);
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    await processBatch(createBatch([message]), handler, { retryDelaySeconds: 30, onError: vi.fn() });
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
  });

  it('retryDelaySeconds 未指定なら引数なしで retry', async () => {
    const message = createMessage('a', 1);
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    await processBatch(createBatch([message]), handler, { onError: vi.fn() });
    expect(message.retry).toHaveBeenCalledWith(undefined);
  });

  it('1 invocation の外部呼び出し数はバッチ長で bound される', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => createMessage(String(i), i));
    let externalCalls = 0;
    const handler = vi.fn(async () => {
      externalCalls++; // 1 メッセージ = 1 外部呼び出し想定
    });
    await processBatch(createBatch(messages), handler);
    // max_batch_size 相当（ここでは 10）を超えて呼ばれない
    expect(externalCalls).toBe(10);
    expect(externalCalls).toBeLessThanOrEqual(messages.length);
  });
});
