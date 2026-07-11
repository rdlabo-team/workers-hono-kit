import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/**
 * `payment_failed` persistence helpers (MySQL / Drizzle).
 *
 * @remarks
 * Lives in the `./db` subpath because it imports `drizzle-orm` (a peer); the web-standard root export
 * must stay free of ORM deps. The helper only builds SQL fragments — the consumer's repository
 * executes them, so it works regardless of the consumer's DB access layer (`db.write` / `helper.query`).
 */

/**
 * The `onDuplicateKeyUpdate.set` for an `insert(paymentFailed)…` that **never re-opens a `resolved`
 * row** — the idempotency guard against Stripe's delayed/out-of-order webhook redelivery leaving a
 * paid user with a permanent failure banner.
 *
 * @remarks
 * `receipt` is evaluated **before** `status` (Drizzle emits the SET clause in the object's insertion
 * order and MySQL evaluates it left→right, so later columns would otherwise see the already-updated
 * `status`). Both branch on the *pre-update* `payment_failed.status`; `type`/`user_id` are always
 * refreshed. Spread into the call:
 * `insert(paymentFailed).values(...).onDuplicateKeyUpdate({ set: reopenGuardedPaymentFailedSet() })`.
 *
 * Assumes the canonical column names (`type`, `user_id`, `status`, `receipt`) and the Drizzle schema
 * property names (`type`, `userId`, `status`, `receipt`) used fleet-wide.
 */
export function reopenGuardedPaymentFailedSet(): Record<'type' | 'userId' | 'status' | 'receipt', SQL> {
  return {
    type: sql`values(\`type\`)`,
    userId: sql`values(\`user_id\`)`,
    // resolved 行は理由も status も据え置き（再オープンしない）。status 代入より前に評価する。
    receipt: sql`IF(\`payment_failed\`.\`status\` = 'resolved', \`payment_failed\`.\`receipt\`, values(\`receipt\`))`,
    status: sql`IF(\`payment_failed\`.\`status\` = 'resolved', \`payment_failed\`.\`status\`, values(\`status\`))`,
  };
}
