// @rdlabo/workers-hono-kit — フリート共通のインフラ層ヘルパ（receptray / winecode / foodlabel）。
// ドメイン・DB・各 repo 固有の parity 差異（auth エラー status/body、secretId、Secret スキーマ）は
// 各 repo 側に残し、ここには「設定注入で汎用化できるインフラ」だけを置く。

// middleware
export { finalizeResponse } from './middleware/finalize-response';
export { validate, createSentryValidate } from './middleware/validation';
export type {
  ValidateOptions,
  ValidationTarget,
  ZodErrorLike,
  SentryLike,
  SentryScopeLike,
} from './middleware/validation';
export { zNum, zNumNullable, zNumOptional, zNumWithDefault } from './middleware/zod-coerce';
export { createAuthMiddleware } from './middleware/auth';
export type { AuthMiddlewareOptions } from './middleware/auth';

// http
export { getUserProtocol } from './http/user-protocol';
export type { IUserProtocol } from './http/user-protocol';
export { getAppInfo } from './http/app-info';
export type { AppInfo } from './http/app-info';
export { resolveAppEnv, isProductionEnv } from './http/app-env';
export type { AppEnv } from './http/app-env';
export { HttpStatus } from './http/http-status';
export { createNestErrorHandler, nestNotFoundHandler, NEST_REASON_PHRASES } from './http/nest-error';
export type { NestErrorHandlerOptions, ErrorReportContext, ErrorReporter } from './http/nest-error';

// cache
export { KVCache } from './cache/kv-cache';
export type { KVNamespace, KVCacheOptions } from './cache/kv-cache';

// stripe
export { createStripeClient, verifyStripeWebhook } from './stripe/client';
export type { CreateStripeClientOptions } from './stripe/client';

// db
export { retryWhenDeadlock } from './db/retry';

// ai
export { createAiGatewayProvider } from './ai/gateway';
export type { AiGatewayConfig, AiGatewayProvider, AiGatewayBinding, AiGateway, AiGatewayOptions } from './ai/gateway';

// aws
export { getAuthenticationSecret } from './aws/secrets-manager';
export type { AwsSecretsOptions } from './aws/secrets-manager';
export { getCloudFrontSignedUrl } from './aws/cloudfront';

// firebase
export type { DecodedIdToken, FirebaseVerifier } from './firebase/firebase-verifier';
export { JoseFirebaseVerifier, SECURETOKEN_JWK_URL } from './firebase/jose-firebase-verifier';
export { IdentityToolkit } from './firebase/identity-toolkit';
export type { ServiceAccount } from './firebase/identity-toolkit';
export { createRemoteFirebaseVerifier, createServiceAccountVerifier } from './firebase/remote-verifier';
