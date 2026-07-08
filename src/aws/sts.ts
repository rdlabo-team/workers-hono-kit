import { AwsClient } from 'aws4fetch';

/** STS SigV4 signing region for the global endpoint (`sts.amazonaws.com`). */
const DEFAULT_STS_REGION = 'us-east-1';
/** winecode / airlec default — 15 minutes. */
const DEFAULT_DURATION_SECONDS = 900;
const STS_API_VERSION = '2011-06-15';
/** Global STS endpoint (unchanged from winecode AwsService). */
const DEFAULT_STS_ENDPOINT = 'https://sts.amazonaws.com/';

/**
 * AWS credentials used to sign an STS `AssumeRole` request.
 *
 * @remarks
 * Same shape as {@link AwsSecretsOptions} minus the required Secrets Manager region; STS defaults to
 * the global endpoint (`us-east-1`) unless {@link GetTemporaryCredentialsOptions.region} is set.
 */
export interface GetTemporaryCredentialsOptions {
  /** AWS access key ID of the caller principal that may AssumeRole. */
  accessKeyId: string;
  /** AWS secret access key of the caller principal. */
  secretAccessKey: string;
  /** Optional STS session token when the caller already holds temporary credentials. */
  sessionToken?: string;
  /** ARN of the role to assume (e.g. `arn:aws:iam::123:role/s3-put-app-only-role`). */
  roleArn: string;
  /** Session name recorded in CloudTrail (often `session-${userId}-${Date.now()}`). */
  roleSessionName: string;
  /**
   * Credential lifetime in seconds.
   * @defaultValue 900
   */
  durationSeconds?: number;
  /**
   * STS SigV4 signing region.
   * @defaultValue us-east-1
   */
  region?: string;
  /**
   * STS endpoint URL.
   * @defaultValue https://sts.amazonaws.com/
   */
  endpoint?: string;
}

/**
 * Temporary credentials returned by STS `AssumeRole`.
 *
 * @remarks
 * Field names match the STS XML response / `@aws-sdk/client-sts` `Credentials` shape so browser
 * apps can pass them straight into `@aws-sdk/client-s3` (`AccessKeyId` → `accessKeyId`, etc.).
 */
export interface StsCredentials {
  AccessKeyId?: string;
  SecretAccessKey?: string;
  SessionToken?: string;
  Expiration?: Date;
}

/**
 * Call STS `AssumeRole` via SigV4-signed `fetch` (aws4fetch) and return temporary credentials.
 *
 * Port of winecode / airlec browser-upload credential issuance — no AWS SDK. The consuming app
 * supplies `roleArn` and `roleSessionName`; the kit only performs the signed STS request and XML parse.
 *
 * @param options - Caller AWS keys plus assume-role parameters.
 * @returns Temporary credentials for browser or edge PutObject / GetObject.
 * @throws Error When the STS response is not OK.
 * @example
 * ```ts
 * const credentials = await getTemporaryCredentials({
 *   accessKeyId: env.AWS_ACCESS_KEY_ID,
 *   secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
 *   roleArn: 'arn:aws:iam::123:role/s3-put-app-only-role',
 *   roleSessionName: `session-${userId}-${Date.now()}`,
 * });
 * ```
 */
export async function getTemporaryCredentials(options: GetTemporaryCredentialsOptions): Promise<StsCredentials> {
  const region = options.region ?? DEFAULT_STS_REGION;
  const durationSeconds = options.durationSeconds ?? DEFAULT_DURATION_SECONDS;
  const endpoint = options.endpoint ?? DEFAULT_STS_ENDPOINT;

  const params = new URLSearchParams({
    Action: 'AssumeRole',
    Version: STS_API_VERSION,
    RoleArn: options.roleArn,
    RoleSessionName: options.roleSessionName,
    DurationSeconds: String(durationSeconds),
  });

  const aws = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    sessionToken: options.sessionToken,
    region,
    service: 'sts',
  });

  const response = await aws.fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`STS AssumeRole failed: ${response.status} ${xml}`);
  }

  const pick = (tag: string): string | undefined => {
    const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
    return m ? m[1] : undefined;
  };

  const expiration = pick('Expiration');
  return {
    AccessKeyId: pick('AccessKeyId'),
    SecretAccessKey: pick('SecretAccessKey'),
    SessionToken: pick('SessionToken'),
    Expiration: expiration ? new Date(expiration) : undefined,
  };
}
