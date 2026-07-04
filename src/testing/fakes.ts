import type { Pool } from 'mysql2/promise';
import { databaseFrom } from '../db/database.js';
import type { DisposableDatabase } from '../db/database.js';
import type { DecodedIdToken, FirebaseVerifier } from '../firebase/firebase-verifier.js';

/**
 * In-memory {@link FirebaseVerifier} implementation for offline route tests.
 *
 * Seed fake identities with {@link FakeFirebaseVerifier.register | register(token, { uid })}, then
 * verification resolves the registered decoded token instead of calling a real Firebase backend.
 *
 * @example
 * ```ts
 * const firebase = new FakeFirebaseVerifier();
 * firebase.register('tok-1', { uid: 'uid-1' });
 * const decoded = await firebase.verifyIdToken('tok-1'); // { uid: 'uid-1' }
 * ```
 */
export class FakeFirebaseVerifier implements FirebaseVerifier {
  private readonly tokens = new Map<string, DecodedIdToken>();
  /** UIDs passed to {@link FakeFirebaseVerifier.deleteUser}, in call order, for assertions. */
  readonly deleted: string[] = [];

  /**
   * Register a fake decoded token so that {@link FakeFirebaseVerifier.verifyIdToken} resolves it.
   *
   * @param token - Token string clients will present.
   * @param record - Decoded token returned on verification (must include `uid`).
   */
  register(token: string, record: DecodedIdToken): void {
    this.tokens.set(token, record);
  }

  /**
   * Resolve the decoded token previously registered for `idToken`.
   *
   * @param idToken - Token string to verify.
   * @returns The registered decoded token.
   * @throws Error if the token was never registered.
   */
  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    const record = this.tokens.get(idToken);
    if (!record) {
      throw new Error('invalid firebase id token');
    }
    return record;
  }

  /**
   * Return a minimal user record echoing the requested UID.
   *
   * @param uid - UID to look up.
   * @returns An object containing the `uid` (never `null` in this fake).
   */
  async getUser(uid: string): Promise<{ uid: string; email?: string } | null> {
    return { uid };
  }

  /**
   * Return minimal user records echoing each requested UID.
   *
   * @param uids - UIDs to look up.
   * @returns One `{ uid }` entry per requested uid (never omits any, in this fake).
   */
  async getUsers(uids: string[]): Promise<{ uid: string; email?: string }[]> {
    return uids.map((uid) => ({ uid }));
  }

  /**
   * Record a user deletion by appending the UID to {@link FakeFirebaseVerifier.deleted}.
   *
   * @param uid - UID being deleted.
   */
  async deleteUser(uid: string): Promise<void> {
    this.deleted.push(uid);
  }
}

/**
 * Options for {@link createPoolDatabase}.
 *
 * @typeParam TDrizzle - The Drizzle instance type, supplied by the consumer so that type identity is
 *   not coupled to this package's copy of `drizzle-orm`.
 */
export interface CreatePoolDatabaseOptions<TDrizzle> {
  /** Test pool used as both primary and replica. */
  pool: Pool;
  /** Drizzle instance built by the consumer with its own `drizzle-orm`, e.g. `drizzle(pool, { schema, ... })`. */
  orm: TDrizzle;
}

/**
 * Create a `Database` backed by a single pool used as both primary and replica, suitable for tests.
 *
 * @remarks
 * `dispose()` ends the pool. The `orm` is provided by the caller (rather than constructed here) so
 * the returned database uses the consumer's own `drizzle-orm` types, avoiding type-identity clashes
 * across duplicated `drizzle-orm` installs.
 *
 * @typeParam TDrizzle - The Drizzle instance type provided by the consumer.
 * @param options - Pool and Drizzle instance. See {@link CreatePoolDatabaseOptions}.
 * @returns A {@link DisposableDatabase} whose `dispose()` closes the pool.
 * @example
 * ```ts
 * const pool = testDb.createTestPool();
 * const db = createPoolDatabase({ pool, orm: drizzle(pool, { schema }) });
 * // ... run tests ...
 * await db.dispose();
 * ```
 */
export function createPoolDatabase<TDrizzle>(
  options: CreatePoolDatabaseOptions<TDrizzle>,
): DisposableDatabase<TDrizzle> {
  const { pool, orm } = options;
  const base = databaseFrom(orm, pool);
  return {
    ...base,
    async dispose(): Promise<void> {
      await pool.end();
    },
  };
}

/**
 * Create a no-op `Database` stub for routes that never touch the database (e.g. plain GET handlers).
 *
 * @remarks
 * `read` resolves to an empty array, while `write` and `transaction` throw so that any unexpected
 * database access is caught as a misuse. `dispose` is a no-op, so this can stand in for a
 * {@link DisposableDatabase} backing (e.g. a Hyperdrive- or pool-based one) without changes.
 *
 * @typeParam TDrizzle - The Drizzle instance type the consumer expects (defaults to `unknown`).
 * @returns A {@link DisposableDatabase} that reads empty and throws on writes/transactions.
 * @throws Error from `write`/`transaction` if they are accessed.
 * @example
 * ```ts
 * const db = createNoopDatabase();
 * await db.read('SELECT 1'); // []
 * await db.write(async (dz) => dz); // throws: noopDatabase.write accessed unexpectedly
 * ```
 */
export function createNoopDatabase<TDrizzle = unknown>(): DisposableDatabase<TDrizzle> {
  return {
    read: async () => [],
    write: () => {
      throw new Error('noopDatabase.write accessed unexpectedly');
    },
    transaction: () => {
      throw new Error('noopDatabase.transaction accessed unexpectedly');
    },
    dispose: async () => {},
  };
}
