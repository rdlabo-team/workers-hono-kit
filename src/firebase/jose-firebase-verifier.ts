import { jwtVerify } from 'jose';
import type { CryptoKey, JWK, JWTVerifyGetKey, KeyObject } from 'jose';
import type { DecodedIdToken, FirebaseVerifier } from './firebase-verifier.js';
import type { IdentityToolkit } from './identity-toolkit.js';

/**
 * Union of every key shape `jose`'s `jwtVerify` accepts.
 *
 * @remarks
 * `jose` v6 removed `KeyLike`, so the verification key is modelled here as either a static
 * key (production uses `createRemoteJWKSet`, tests use a generated `CryptoKey`) or a dynamic
 * `JWTVerifyGetKey` resolver function. This union covers both `jwtVerify` overloads' key
 * parameters.
 *
 * @internal
 */
type KeyInput = CryptoKey | KeyObject | JWK | Uint8Array | JWTVerifyGetKey;

/**
 * URL of Google's securetoken JWKS endpoint, which serves the public keys used to sign
 * Firebase ID tokens.
 *
 * @remarks
 * Passed to `createRemoteJWKSet` (see `createRemoteFirebaseVerifier`) so RS256 signatures can
 * be verified against Google's rotating public keys.
 */
export const SECURETOKEN_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/**
 * Verifies Firebase ID tokens with `jose` RS256 against Google's securetoken JWKS, and
 * optionally looks up or deletes users via the Google Identity Toolkit REST API.
 *
 * This replaces the `firebase-admin` Auth surface (`verifyIdToken` / `getUser` /
 * `deleteUser`) in environments where the Node SDK cannot run, such as Cloudflare Workers.
 * Token verification mirrors the admin SDK's checks: issuer and audience equal to the
 * project id, an RS256 signature, a non-empty subject (the uid), and a valid `auth_time`.
 *
 * @remarks
 * The verification key is supplied as `keyResolver`:
 * - Production: `createRemoteJWKSet(new URL(SECURETOKEN_JWK_URL))`, which fetches and caches
 *   Google's public keys.
 * - Tests: a generated public key, allowing fully offline verification with no network.
 *
 * `getUser` / `deleteUser` delegate to {@link IdentityToolkit} (a network call); when no
 * `IdentityToolkit` is configured they throw.
 *
 * @see {@link FirebaseVerifier} for the abstract boundary this implements.
 */
export class JoseFirebaseVerifier implements FirebaseVerifier {
  /**
   * Create a verifier.
   *
   * @param opts - Verifier configuration.
   * @param opts.projectId - The Firebase project id, used as both the expected token issuer
   *   (`https://securetoken.google.com/<projectId>`) and audience.
   * @param opts.keyResolver - The RS256 verification key or a dynamic key resolver function.
   * @param opts.identity - Optional Identity Toolkit client enabling `getUser` / `deleteUser`.
   * @param opts.now - Optional clock returning the current time in seconds; injectable for
   *   deterministic tests. Defaults to the system clock.
   */
  constructor(
    private readonly opts: {
      projectId: string;
      keyResolver: KeyInput;
      identity?: IdentityToolkit;
      now?: () => number; // seconds; injectable for tests
    },
  ) {}

  /**
   * Verify a Firebase ID token and return its decoded payload.
   *
   * Checks the RS256 signature against the configured key, enforces the expected issuer and
   * audience (the project id), and applies the admin SDK's extra checks: a non-empty string
   * subject of at most 128 characters and an `auth_time` that is a number not in the future.
   *
   * @param idToken - The raw Firebase ID token (JWT) to verify.
   * @returns The decoded payload, with `uid` set from `sub` and `email` lifted to a top-level field.
   * @throws If the signature, issuer, audience, or expiry are invalid, if the subject is
   *   missing/non-string/too long, or if `auth_time` is missing or in the future.
   */
  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    const options = {
      issuer: `https://securetoken.google.com/${this.opts.projectId}`,
      audience: this.opts.projectId,
      algorithms: ['RS256'] as string[],
    };
    // Branch so each call matches a single jwtVerify overload (static key vs getKey fn).
    const key = this.opts.keyResolver;
    const { payload } =
      typeof key === 'function' ? await jwtVerify(idToken, key, options) : await jwtVerify(idToken, key, options);
    // Mirror firebase-admin's extra checks beyond signature/iss/aud/exp:
    if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) {
      throw new Error('Firebase ID token has an invalid subject');
    }
    const authTime = payload.auth_time;
    if (typeof authTime !== 'number' || authTime > this.nowSeconds()) {
      throw new Error('Firebase ID token has an invalid auth_time');
    }
    return { ...payload, uid: payload.sub, email: payload.email as string | undefined };
  }

  /**
   * Look up a user record by uid via the Identity Toolkit REST API.
   *
   * @param uid - The user's unique id.
   * @returns The user's `uid` and optional `email`, or `null` when the user does not exist.
   * @throws If no Identity Toolkit client was configured on this verifier.
   */
  async getUser(uid: string): Promise<{ uid: string; email?: string } | null> {
    if (!this.opts.identity) {
      throw new Error('Identity Toolkit not configured');
    }
    return this.opts.identity.lookup(uid, this.nowSeconds());
  }

  /**
   * Look up multiple user records by uid via the Identity Toolkit REST API.
   *
   * Batches the lookups into `ceil(uids.length / 100)` `accounts:lookup` requests instead of
   * one request per uid.
   *
   * @param uids - The users' unique ids to look up.
   * @returns The `uid`/`email` of every matching user. Uids Firebase does not recognize are
   *   simply absent from the result (never `null` entries).
   * @throws If no Identity Toolkit client was configured on this verifier.
   */
  async getUsers(uids: string[]): Promise<{ uid: string; email?: string }[]> {
    if (!this.opts.identity) {
      throw new Error('Identity Toolkit not configured');
    }
    return this.opts.identity.lookupMany(uids, this.nowSeconds());
  }

  /**
   * Delete a user by uid via the Identity Toolkit REST API.
   *
   * @param uid - The user's unique id.
   * @returns A promise that resolves once the user has been deleted.
   * @throws If no Identity Toolkit client was configured on this verifier, or the deletion fails.
   */
  async deleteUser(uid: string): Promise<void> {
    if (!this.opts.identity) {
      throw new Error('Identity Toolkit not configured');
    }
    await this.opts.identity.remove(uid, this.nowSeconds());
  }

  /**
   * Return the current time in seconds, using the injected clock when provided.
   *
   * @returns The current Unix time in seconds.
   * @internal
   */
  private nowSeconds(): number {
    return this.opts.now ? this.opts.now() : Math.floor(Date.now() / 1000);
  }
}
