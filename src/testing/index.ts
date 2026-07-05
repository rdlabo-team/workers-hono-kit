/**
 * Shared test infrastructure for Hono on Cloudflare Workers projects (depends on `mysql2`/`drizzle-orm`).
 *
 * Test-only helpers that are never loaded at runtime. This subpath consolidates the duplicated
 * test boilerplate (test DB setup, in-memory fakes, auth header builders, Stripe fixtures) that
 * tends to be copy-pasted across projects into a single, importable surface.
 */

export { createTestDb } from './db.js';
export type { TestDb, CreateTestDbOptions, TestDbConnection } from './db.js';

export { FakeFirebaseVerifier, createPoolDatabase, createNoopDatabase } from './fakes.js';
export type { CreatePoolDatabaseOptions } from './fakes.js';
export type { Database, DisposableDatabase, QueryRunner, TxOf } from '../db/database.js';

// Authentication test helpers (route-spec header builders and user provisioning).
export { authHeaders, registerFirebaseToken, provisionUser } from './auth.js';

// Test double helper (partial-implementation fake that throws explicitly on unconfigured members).
export { configurableFake } from './configurable-fake.js';

// Test fixture factories for Stripe objects.
export {
  fakeApiList,
  fakePaymentIntent,
  fakeStripeEvent,
  fakeCheckoutSession,
  fakeCustomer,
  fakePrice,
  fakeSubscription,
} from './stripe-fixtures.js';

// In-memory Workers binding fakes (KV / Queues producer).
export { fakeKv, fakeQueue } from './workers-bindings.js';
export type { FakeQueue } from './workers-bindings.js';
