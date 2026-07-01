/**
 * Producer-side helper for fanning a large list of items into a Cloudflare Queue without letting the
 * producer's own subrequest count scale linearly with the list.
 *
 * A Worker may issue at most 50 (free) / 1000 (paid) subrequests per invocation, and each
 * {@link QueueLike.send} counts as one subrequest. Enqueuing `N` items with per-item `send()` calls
 * therefore reintroduces the very unbounded fan-out that queues exist to remove. {@link sendInChunks}
 * instead groups items into batches and issues one {@link QueueLike.sendBatch} per batch, so the
 * producer spends `ceil(N / chunkSize)` subrequests regardless of how large `N` grows.
 *
 * The heavy per-item work (external API calls, etc.) is expected to run in the queue *consumer*,
 * where each invocation processes only `max_batch_size` messages and thus enjoys its own bounded
 * subrequest budget. See {@link processBatch} for the consumer side.
 *
 * @example
 * ```ts
 * // In a Cron Trigger `scheduled` handler: enqueue every billing user, then let the consumer
 * // re-derive payment state one user per message.
 * const userIds = await query.getUserIdForReloadCustomer(); // DB read — not a subrequest
 * await sendInChunks(env.PAYMENT_RELOAD_QUEUE, userIds);     // ceil(N / 100) subrequests
 * ```
 *
 * @packageDocumentation
 */

/**
 * Minimal subset of `@cloudflare/workers-types`' `Queue` used by {@link sendInChunks}.
 *
 * Declared locally so consumers are not forced to depend on `@cloudflare/workers-types`. Only the
 * batch-send operation the helper actually needs is modeled.
 *
 * @typeParam Body - Type of each message body enqueued onto this queue.
 */
export interface QueueLike<Body = unknown> {
  /**
   * Enqueue up to 100 messages in a single operation (one subrequest).
   *
   * @param messages - The message envelopes to enqueue; at most 100 per call, 256 KB per batch.
   * @param options - Optional batch-level options, e.g. a `delaySeconds` applied to every message.
   * @returns A promise that resolves once the batch is accepted. The resolved value is ignored, so a
   *   real `Queue` binding (whose `sendBatch` resolves to a `QueueSendBatchResponse`) is assignable.
   */
  sendBatch: (messages: Iterable<QueueSendMessage<Body>>, options?: { delaySeconds?: number }) => Promise<unknown>;
}

/**
 * A single message envelope passed to {@link QueueLike.sendBatch}.
 *
 * @typeParam Body - Type of the message body.
 */
export interface QueueSendMessage<Body = unknown> {
  /** The message payload; structured-cloned by the Queues runtime. */
  body: Body;
  /** Optional content type hint (`'json'` by default for object bodies). */
  contentType?: 'text' | 'bytes' | 'json' | 'v8';
  /** Optional per-message delivery delay, in seconds. */
  delaySeconds?: number;
}

/**
 * The Cloudflare Queues hard limit on messages per {@link QueueLike.sendBatch} call.
 */
const MAX_BATCH_SIZE = 100;

/**
 * Split a list into fixed-size chunks (order preserving).
 *
 * @typeParam T - Element type.
 * @param items - Source list.
 * @param size - Maximum chunk length (assumed `>= 1`).
 * @returns An array of chunks, each at most `size` long.
 * @internal
 */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * Enqueue every item in `items` using batched sends so the producer's subrequest count stays
 * bounded at `ceil(items.length / chunkSize)` rather than growing per item.
 *
 * Each element becomes one queue message (`{ body: item }`); wrap or map your rows into small,
 * self-describing payloads (e.g. an id plus a discriminator) before calling. Keep each batch under
 * the Queues 256 KB limit — with `chunkSize <= 100` and small id-shaped payloads this is not a
 * concern, but large bodies may require a smaller `chunkSize`.
 *
 * Batches are sent sequentially so a mid-list failure surfaces promptly (the already-sent batches
 * are durably enqueued; the throw lets the caller decide whether to retry the remainder). An empty
 * `items` is a no-op.
 *
 * @typeParam Body - Type of each message body.
 * @param queue - The producer binding to send onto.
 * @param items - The full list of message bodies to enqueue; may be arbitrarily large.
 * @param options - Tuning options.
 * @param options.chunkSize - Messages per `sendBatch` call. Defaults to and is capped at 100 (the
 *   Queues per-batch maximum); values below 1 are clamped to 1.
 * @returns The number of `sendBatch` calls issued (i.e. subrequests spent), useful for asserting the
 *   fan-out stayed bounded in tests.
 * @example
 * ```ts
 * const batches = await sendInChunks(env.MY_QUEUE, ids);        // one send per 100 ids
 * const batches = await sendInChunks(env.MY_QUEUE, rows, {      // custom batch size for larger bodies
 *   chunkSize: 25,
 * });
 * ```
 */
export async function sendInChunks<Body>(
  queue: QueueLike<Body>,
  items: readonly Body[],
  options?: { chunkSize?: number },
): Promise<number> {
  if (items.length === 0) {
    return 0;
  }
  const chunkSize = Math.min(MAX_BATCH_SIZE, Math.max(1, Math.trunc(options?.chunkSize ?? MAX_BATCH_SIZE)));
  const batches = chunk(items, chunkSize);
  for (const batch of batches) {
    await queue.sendBatch(batch.map((body) => ({ body })));
  }
  return batches.length;
}
