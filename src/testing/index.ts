// @rdlabo/hono-kit/testing — フリート共通のテスト基盤（mysql2/drizzle 依存）。
// 実行時には読み込まれないテスト専用ヘルパ。各 repo の testing/db.ts・fakes.ts を集約。

export { createTestDb } from './db';
export type { TestDb, CreateTestDbOptions, TestDbConnection } from './db';

export { FakeFirebaseVerifier, createPoolDatabase, createNoopDatabase } from './fakes';
export type { CreatePoolDatabaseOptions } from './fakes';
export type { Database, DisposableDatabase, QueryRunner, TxOf } from '../db/database';

// 認証テストヘルパ（route spec のヘッダ生成・ユーザ provision を集約）。
export { authHeaders, registerFirebaseToken, provisionUser } from './auth';

// test double ヘルパ（未設定メソッドで明示 throw する部分実装 fake）。
export { configurableFake } from './configurable-fake';

// Stripe オブジェクトの test fixture factory。
export {
  fakeApiList,
  fakePaymentIntent,
  fakeStripeEvent,
  fakeCheckoutSession,
  fakeCustomer,
  fakePrice,
  fakeSubscription,
} from './stripe-fixtures';
