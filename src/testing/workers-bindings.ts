import type { KVNamespace } from '../cache/kv-cache.js';
import type { QueueLike, QueueSendMessage } from '../queue/send.js';

/**
 * In-memory {@link QueueLike} test double that records every enqueued message.
 *
 * @remarks
 * `sent` collects all message bodies (from both {@link FakeQueue.send} and
 * {@link FakeQueue.sendBatch}). `batchCount` increments once per `sendBatch` call so tests can
 * assert producers bound subrequests to `ceil(N / chunkSize)` rather than `N`.
 *
 * @typeParam Body - Message body type.
 */
export interface FakeQueue<Body = unknown> extends QueueLike<Body> {
  /** Every body passed to `send` or `sendBatch`, in enqueue order. */
  readonly sent: Body[];
  /** Number of `sendBatch` calls issued. */
  readonly batchCount: number;
  /**
   * Enqueue a single message (one subrequest in production).
   *
   * @param body - Message payload.
   */
  send(body: Body): Promise<void>;
}

/**
 * Create an in-memory {@link FakeQueue} for offline producer tests.
 *
 * @typeParam Body - Message body type.
 * @returns A queue double assignable to `QueueLike` / Workers `Queue` bindings in tests.
 * @example
 * ```ts
 * const queue = fakeQueue<{ userId: number }>();
 * await sendInChunks(queue, [1, 2, 3]);
 * expect(queue.batchCount).toBe(1);
 * expect(queue.sent).toEqual([1, 2, 3]);
 * ```
 */
export function fakeQueue<Body = unknown>(): FakeQueue<Body> {
  const sent: Body[] = [];
  let batchCount = 0;

  return {
    get sent() {
      return sent;
    },
    get batchCount() {
      return batchCount;
    },
    send(body: Body): Promise<void> {
      sent.push(body);
      return Promise.resolve();
    },
    sendBatch(messages: Iterable<QueueSendMessage<Body>>): Promise<void> {
      batchCount++;
      for (const m of messages) {
        sent.push(m.body);
      }
      return Promise.resolve();
    },
  };
}

/**
 * Create a minimal in-memory {@link KVNamespace} for offline tests (`KVCache`, env fixtures, etc.).
 *
 * @remarks
 * Only `get` / `put` / `delete` are fully implemented (the subset {@link KVCache} uses). `list` and
 * `getWithMetadata` return empty/null stubs so the object is structurally assignable to Workers
 * `KVNamespace` when tests need a binding-shaped fake env.
 *
 * @returns An in-memory KV double.
 */
export function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
    list: () => Promise.resolve({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null, cacheStatus: null }),
  } as KVNamespace;
}
