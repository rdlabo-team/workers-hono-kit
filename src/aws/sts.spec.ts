import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTemporaryCredentials } from './sts.js';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleResult>
    <Credentials>
      <AccessKeyId>ASIATESTKEY</AccessKeyId>
      <SecretAccessKey>secretValue</SecretAccessKey>
      <SessionToken>sessionTokenValue</SessionToken>
      <Expiration>2099-01-01T00:00:00Z</Expiration>
    </Credentials>
  </AssumeRoleResult>
</AssumeRoleResponse>`;

describe('sts (aws4fetch AssumeRole)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('signs AssumeRole to the global STS endpoint and parses Credentials XML', async () => {
    const fetchMock = vi.fn(
      (_input: Request | string | URL, _init?: RequestInit) => new Response(SAMPLE_XML, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getTemporaryCredentials({
      accessKeyId: 'AKIAtest',
      secretAccessKey: 'secret',
      roleArn: 'arn:aws:iam::123456789012:role/s3-put-app-only-role',
      roleSessionName: 'session-1-123',
    });

    expect(result.AccessKeyId).toBe('ASIATESTKEY');
    expect(result.SecretAccessKey).toBe('secretValue');
    expect(result.SessionToken).toBe('sessionTokenValue');
    expect(result.Expiration).toEqual(new Date('2099-01-01T00:00:00Z'));

    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.url).toBe('https://sts.amazonaws.com/');
    expect(request.method).toBe('POST');
    expect(request.headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
    const body = await request.clone().text();
    expect(body).toContain('Action=AssumeRole');
    expect(body).toContain('RoleArn=arn%3Aaws%3Aiam%3A%3A123456789012%3Arole%2Fs3-put-app-only-role');
    expect(body).toContain('RoleSessionName=session-1-123');
    expect(body).toContain('DurationSeconds=900');
  });

  it('レスポンスが ok でなければ throw する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('AccessDenied', { status: 403 })),
    );
    await expect(
      getTemporaryCredentials({
        accessKeyId: 'AKIAerr',
        secretAccessKey: 's',
        roleArn: 'arn:aws:iam::1:role/x',
        roleSessionName: 'session-err',
      }),
    ).rejects.toThrow('STS AssumeRole failed: 403');
  });
});
