import { SignJWT, generateKeyPair } from 'jose';
import { describe, it, expect, vi } from 'vitest';
import type { IdentityToolkit } from './identity-toolkit.js';
import { JoseFirebaseVerifier } from './jose-firebase-verifier.js';

// jose v6: generateKeyPair yields CryptoKey; derive the type instead of the removed KeyLike.
type SignKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

const PROJECT = 'rdlabo-proj';
const ISSUER = `https://securetoken.google.com/${PROJECT}`;

async function makeVerifier(identity?: IdentityToolkit) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const verifier = new JoseFirebaseVerifier({ projectId: PROJECT, keyResolver: publicKey, identity });
  return { verifier, privateKey };
}

function sign(
  privateKey: SignKey,
  claims: { iss?: string; aud?: string; sub?: string; expOffset?: number; authTime?: number },
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ auth_time: claims.authTime ?? now }) // firebase-admin requires auth_time
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? PROJECT)
    .setSubject(claims.sub ?? 'uid-123')
    .setIssuedAt(now)
    .setExpirationTime(now + (claims.expOffset ?? 3600))
    .sign(privateKey);
}

describe('JoseFirebaseVerifier (verifyIdToken parity with firebase-admin)', () => {
  it('accepts a valid RS256 token and returns uid = sub', async () => {
    const { verifier, privateKey } = await makeVerifier();
    const token = await sign(privateKey, { sub: 'uid-abc' });
    const decoded = await verifier.verifyIdToken(token);
    expect(decoded.uid).toBe('uid-abc');
  });

  it('rejects a wrong audience (project mismatch)', async () => {
    const { verifier, privateKey } = await makeVerifier();
    const token = await sign(privateKey, { aud: 'other-project' });
    await expect(verifier.verifyIdToken(token)).rejects.toBeDefined();
  });

  it('rejects a wrong issuer', async () => {
    const { verifier, privateKey } = await makeVerifier();
    const token = await sign(privateKey, { iss: 'https://evil.example.com/x' });
    await expect(verifier.verifyIdToken(token)).rejects.toBeDefined();
  });

  it('rejects an expired token', async () => {
    const { verifier, privateKey } = await makeVerifier();
    const token = await sign(privateKey, { expOffset: -10 });
    await expect(verifier.verifyIdToken(token)).rejects.toBeDefined();
  });

  it('rejects a token signed by a different key', async () => {
    const { verifier } = await makeVerifier();
    const { privateKey: otherKey } = await generateKeyPair('RS256');
    const token = await sign(otherKey, {});
    await expect(verifier.verifyIdToken(token)).rejects.toBeDefined();
  });

  it('rejects a subject longer than 128 chars (firebase-admin parity)', async () => {
    const { verifier, privateKey } = await makeVerifier();
    const token = await sign(privateKey, { sub: 'x'.repeat(129) });
    await expect(verifier.verifyIdToken(token)).rejects.toThrow('invalid subject');
  });

  it('rejects an auth_time in the future', async () => {
    const { verifier, privateKey } = await makeVerifier();
    const token = await sign(privateKey, { authTime: Math.floor(Date.now() / 1000) + 9999 });
    await expect(verifier.verifyIdToken(token)).rejects.toThrow('invalid auth_time');
  });

  it('honours an injected now() for auth_time checks', async () => {
    const future = Math.floor(Date.now() / 1000) + 10_000;
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const verifier = new JoseFirebaseVerifier({ projectId: PROJECT, keyResolver: publicKey, now: () => future });
    const token = await sign(privateKey, { authTime: future - 5 });
    await expect(verifier.verifyIdToken(token)).resolves.toMatchObject({ uid: 'uid-123' });
  });

  describe('getUser / deleteUser', () => {
    it('throws when no Identity Toolkit is configured', async () => {
      const { verifier } = await makeVerifier();
      await expect(verifier.getUser('uid1')).rejects.toThrow('Identity Toolkit not configured');
      await expect(verifier.deleteUser('uid1')).rejects.toThrow('Identity Toolkit not configured');
    });

    it('delegates to the Identity Toolkit when configured', async () => {
      const lookup = vi.fn(async () => ({ uid: 'uid1', email: 'a@b.c' }));
      const remove = vi.fn(async () => undefined);
      const identity = { lookup, remove } as unknown as IdentityToolkit;
      const { verifier } = await makeVerifier(identity);

      await expect(verifier.getUser('uid1')).resolves.toEqual({ uid: 'uid1', email: 'a@b.c' });
      await verifier.deleteUser('uid1');
      expect(lookup).toHaveBeenCalledWith('uid1', expect.any(Number));
      expect(remove).toHaveBeenCalledWith('uid1', expect.any(Number));
    });
  });

  describe('getUsers', () => {
    it('throws when no Identity Toolkit is configured', async () => {
      const { verifier } = await makeVerifier();
      await expect(verifier.getUsers(['uid1', 'uid2'])).rejects.toThrow('Identity Toolkit not configured');
    });

    it('delegates to the Identity Toolkit lookupMany with the requested uids', async () => {
      const lookupMany = vi.fn(async () => [{ uid: 'uid1', email: 'a@b.c' }, { uid: 'uid2' }]);
      const identity = { lookupMany } as unknown as IdentityToolkit;
      const { verifier } = await makeVerifier(identity);

      await expect(verifier.getUsers(['uid1', 'uid2'])).resolves.toEqual([
        { uid: 'uid1', email: 'a@b.c' },
        { uid: 'uid2' },
      ]);
      expect(lookupMany).toHaveBeenCalledWith(['uid1', 'uid2'], expect.any(Number));
    });
  });
});
