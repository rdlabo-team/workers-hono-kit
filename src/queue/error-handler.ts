import type { SentryExceptionReporterLike } from '../http/nest-error.js';
import type { QueueMessageLike } from './consumer.js';

/**
 * Options for {@link createQueueErrorHandler}.
 */
export interface CreateQueueErrorHandlerOptions {
  /** Queue name for log prefix and optional capture tags. */
  queue: string;
  /**
   * When set, `captureException` is called only after the final delivery attempt
   * (`message.attempts > maxRetries`). Cloudflare Queues uses 1-based `attempts`; the last delivery
   * before the dead-letter queue has `attempts === maxRetries + 1`.
   */
  maxRetries?: number;
  /** Optional Sentry client. Omit for console-only reporting (e.g. airlec). */
  sentry?: SentryExceptionReporterLike;
  /** Override {@link sentry}.captureException (custom sink). */
  captureException?: SentryExceptionReporterLike['captureException'];
}

/**
 * Factory for {@link processBatch}'s `onError` hook: logs every failure and optionally reports to
 * Sentry (or another sink) with queue / message id / attempts / body context.
 */
export function createQueueErrorHandler(
  options: CreateQueueErrorHandlerOptions,
): (error: unknown, message: QueueMessageLike) => void {
  const { queue, maxRetries, sentry, captureException } = options;
  const capture = captureException ?? sentry?.captureException.bind(sentry);
  return (error, message) => {
    console.error(`[Queue:${queue}] message ${message.id} failed (attempt ${message.attempts})`, error);
    if (!capture) {
      return;
    }
    if (maxRetries !== undefined && message.attempts <= maxRetries) {
      return;
    }
    capture(error, {
      tags: { queue, queue_message_id: message.id },
      extra: { attempts: message.attempts, body: message.body },
    });
  };
}
