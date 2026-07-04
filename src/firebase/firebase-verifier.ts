/**
 * Decoded Firebase ID token payload.
 *
 * Shaped to match the subset of `firebase-admin`'s `DecodedIdToken` that consumers
 * typically rely on: a stable `uid` plus an optional `email`. The index signature keeps
 * every other JWT claim (e.g. `name`, `picture`, custom claims) accessible without
 * enumerating them here.
 *
 * @remarks
 * This is the return type of {@link FirebaseVerifier.verifyIdToken}. The `uid` is derived
 * from the token's `sub` claim.
 */
export interface DecodedIdToken {
  /** The authenticated user's unique id, taken from the token's `sub` claim. */
  uid: string;
  /** The user's email address, when present on the token. */
  email?: string;
  /** Any additional JWT claim carried by the token (custom claims, `name`, `picture`, ...). */
  [claim: string]: unknown;
}

/**
 * Abstract authentication boundary that replaces the `firebase-admin` Auth surface
 * (`verifyIdToken` / `getUser` / `deleteUser`) for environments where the Node SDK cannot
 * run, such as Cloudflare Workers.
 *
 * @remarks
 * Implementations verify Firebase ID tokens and look up or delete accounts without the
 * `firebase-admin` Node dependency. See `JoseFirebaseVerifier` for the `jose`-based
 * implementation and the `createRemoteFirebaseVerifier` / `createServiceAccountVerifier`
 * factories for ready-made instances.
 */
export interface FirebaseVerifier {
  /**
   * Verify a Firebase ID token and return its decoded payload.
   *
   * Mirrors `firebase-admin` `getAuth().verifyIdToken()`.
   *
   * @param idToken - The raw Firebase ID token (JWT) to verify.
   * @returns The decoded token payload.
   * @throws If the token signature, issuer, audience, expiry, or other required claims are invalid.
   */
  verifyIdToken(idToken: string): Promise<DecodedIdToken>;
  /**
   * Look up a user record by uid.
   *
   * Mirrors `firebase-admin` `getAuth().getUser()`.
   *
   * @param uid - The user's unique id.
   * @returns The user's `uid` and optional `email`, or `null` when the user does not exist.
   * @throws If the backing user-management service is not configured or the lookup fails.
   */
  getUser(uid: string): Promise<{ uid: string; email?: string } | null>;
  /**
   * Look up multiple user records by uid in as few requests as the backing service allows.
   *
   * Batched equivalent of {@link getUser}, intended to replace N single-uid lookups with a
   * handful of requests.
   *
   * @param uids - The users' unique ids to look up.
   * @returns The `uid`/`email` of every matching user. Uids that do not resolve to a user are
   *   simply absent from the result (never `null` entries).
   * @throws If the backing user-management service is not configured or the lookup fails.
   */
  getUsers(uids: string[]): Promise<{ uid: string; email?: string }[]>;
  /**
   * Delete a user by uid.
   *
   * Mirrors `firebase-admin` `getAuth().deleteUser()`.
   *
   * @param uid - The user's unique id.
   * @returns A promise that resolves once the user has been deleted.
   * @throws If the backing user-management service is not configured or the deletion fails.
   */
  deleteUser(uid: string): Promise<void>;
}
