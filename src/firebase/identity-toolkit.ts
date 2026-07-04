import { SignJWT, importPKCS8 } from 'jose';

/**
 * Minimal service-account credential consumed by {@link IdentityToolkit}.
 *
 * @remarks
 * Corresponds to the relevant fields of a Google service-account JSON key file.
 */
export interface ServiceAccount {
  /** The service account's email, used as the JWT assertion issuer and subject. */
  client_email: string;
  /** The PEM-encoded PKCS#8 RSA private key used to sign the OAuth2 assertion. */
  private_key: string;
  /** The Google/Firebase project id the Identity Toolkit calls target. */
  project_id: string;
}

/** Google OAuth2 token endpoint used to exchange a signed JWT assertion for an access token. */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Base URL of the Google Identity Toolkit v1 REST API. */
const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';
/** OAuth2 scopes required for Identity Toolkit account lookup and deletion. */
const SCOPE = 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase';
/** Maximum number of `localId`s the `accounts:lookup` endpoint accepts in a single request. */
const LOOKUP_CHUNK_SIZE = 100;

/**
 * Minimal Google Identity Toolkit REST client for the user-management operations that token
 * verification does not cover: `accounts:lookup` (getUser) and `accounts:delete` (deleteUser).
 *
 * This replaces the parts of the `firebase-admin` Node SDK that cannot run on Cloudflare
 * Workers (workerd).
 *
 * @remarks
 * Authentication follows the JWT-bearer flow: a JWT assertion is signed with the service
 * account's private key (via `jose`), exchanged at the OAuth2 token endpoint for an access
 * token, and that token is then used to call the REST API. Access tokens are cached in-process
 * and reused until shortly before they expire.
 */
export class IdentityToolkit {
  /** Cached OAuth2 access token and its absolute expiry (Unix seconds), or `null` when none. */
  private accessToken: { value: string; expiresAt: number } | null = null;

  /**
   * Create a client bound to a single service account.
   *
   * @param sa - The service-account credential used to authenticate REST calls.
   */
  constructor(private readonly sa: ServiceAccount) {}

  /**
   * Return a valid OAuth2 access token, minting a new one when the cache is empty or expiring.
   *
   * Signs a short-lived JWT assertion with the service-account key and exchanges it at the
   * Google OAuth2 token endpoint. The result is cached and reused while it remains valid
   * (with a 60-second safety margin).
   *
   * @param nowSeconds - The current Unix time in seconds, used for cache validity and JWT timestamps.
   * @returns A bearer access token for the Identity Toolkit API.
   * @throws If the token exchange request fails.
   * @internal
   */
  private async getAccessToken(nowSeconds: number): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > nowSeconds + 60) {
      return this.accessToken.value;
    }
    const key = await importPKCS8(this.sa.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.sa.client_email)
      .setSubject(this.sa.client_email)
      .setAudience(TOKEN_URL)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + 3600)
      .sign(key);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) {
      throw new Error(`Identity Toolkit token exchange failed: ${res.status}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: json.access_token, expiresAt: nowSeconds + json.expires_in };
    return json.access_token;
  }

  /**
   * Call the `accounts:lookup` endpoint for a single chunk of `localId`s.
   *
   * @param localIds - Up to {@link LOOKUP_CHUNK_SIZE} `localId`s to look up in one request.
   * @param nowSeconds - The current Unix time in seconds, used for access-token caching.
   * @returns The raw `users` entries returned by the endpoint (empty when the request is
   *   unsuccessful or no matching users are returned).
   * @throws If acquiring an access token fails.
   * @internal
   */
  private async lookupChunk(localIds: string[], nowSeconds: number): Promise<{ localId: string; email?: string }[]> {
    const token = await this.getAccessToken(nowSeconds);
    const res = await fetch(`${IDENTITY_TOOLKIT}/projects/${this.sa.project_id}/accounts:lookup`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ localId: localIds }),
    });
    if (!res.ok) {
      return [];
    }
    const json = (await res.json()) as { users?: { localId: string; email?: string }[] };
    return json.users ?? [];
  }

  /**
   * Look up a user record by uid via the `accounts:lookup` endpoint.
   *
   * @param uid - The user's unique id (`localId`).
   * @param nowSeconds - The current Unix time in seconds, used for access-token caching.
   * @returns The user's `uid` and optional `email`, or `null` when the request is unsuccessful
   *   or no matching user is returned.
   * @throws If acquiring an access token fails.
   */
  async lookup(uid: string, nowSeconds: number): Promise<{ uid: string; email?: string } | null> {
    const users = await this.lookupChunk([uid], nowSeconds);
    return users.length > 0 ? { uid: users[0].localId, email: users[0].email } : null;
  }

  /**
   * Look up multiple user records by uid via the `accounts:lookup` endpoint.
   *
   * `uids` are chunked into groups of at most {@link LOOKUP_CHUNK_SIZE} (the maximum `localId`
   * array size the endpoint accepts), issuing one `accounts:lookup` request per chunk. This lets
   * callers replace N single-uid lookups with `ceil(N / LOOKUP_CHUNK_SIZE)` requests.
   *
   * @param uids - The users' unique ids (`localId`s) to look up.
   * @param nowSeconds - The current Unix time in seconds, used for access-token caching.
   * @returns The `uid`/`email` of every matching user. Uids Firebase does not recognize are
   *   simply absent from the result (never `null` entries), so callers can treat "missing from
   *   the result" as "not found/invalid".
   * @throws If acquiring an access token fails.
   */
  async lookupMany(uids: string[], nowSeconds: number): Promise<{ uid: string; email?: string }[]> {
    if (uids.length === 0) {
      return [];
    }
    const results: { uid: string; email?: string }[] = [];
    for (let i = 0; i < uids.length; i += LOOKUP_CHUNK_SIZE) {
      const chunk = uids.slice(i, i + LOOKUP_CHUNK_SIZE);
      const users = await this.lookupChunk(chunk, nowSeconds);
      for (const user of users) {
        results.push({ uid: user.localId, email: user.email });
      }
    }
    return results;
  }

  /**
   * Delete a user by uid via the `accounts:delete` endpoint.
   *
   * @param uid - The user's unique id (`localId`).
   * @param nowSeconds - The current Unix time in seconds, used for access-token caching.
   * @returns A promise that resolves once the user has been deleted.
   * @throws If acquiring an access token fails or the delete request is unsuccessful.
   */
  async remove(uid: string, nowSeconds: number): Promise<void> {
    const token = await this.getAccessToken(nowSeconds);
    const res = await fetch(`${IDENTITY_TOOLKIT}/projects/${this.sa.project_id}/accounts:delete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ localId: uid }),
    });
    if (!res.ok) {
      throw new Error(`Identity Toolkit delete failed: ${res.status}`);
    }
  }
}
