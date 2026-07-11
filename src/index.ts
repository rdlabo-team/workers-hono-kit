/**
 * `@rdlabo/workers-hono-kit` — infrastructure-layer helpers for Hono on Cloudflare Workers.
 *
 * This package collects reusable, configuration-injected building blocks (HTTP middleware,
 * caching, Stripe, Drizzle helpers, AI Gateway, AWS/Firebase integrations) that can be shared
 * across services. Domain logic, database schemas, and application-specific behavior are
 * intentionally left to the consuming application; only generic infrastructure that can be made
 * reusable through dependency/configuration injection lives here.
 *
 * @packageDocumentation
 */

// middleware
export { finalizeResponse } from './middleware/finalize-response.js';
export { validate, createValidate } from './middleware/validation.js';
// Backward-compat alias; prefer createValidate({ sentry }).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- intentional public re-export
export { createSentryValidate } from './middleware/validation.js';
export type {
  ValidateOptions,
  ValidationTarget,
  ZodErrorLike,
  SentryLike,
  SentryScopeLike,
} from './middleware/validation.js';
export { zNum, zNumNullable, zNumOptional, zNumWithDefault } from './middleware/zod-coerce.js';
export { createAuthMiddleware } from './middleware/auth.js';
export type { AuthMiddlewareOptions } from './middleware/auth.js';
export { perfLog } from './middleware/perf-log.js';
export type { PerfLogOptions, AnalyticsEngineDatasetLike } from './middleware/perf-log.js';
export { createIsolateMemo } from './container/isolate-memo.js';
export type { IsolateMemo } from './container/isolate-memo.js';
export { createContainerRuntime } from './container/middleware.js';
export type { ContainerBuildContext, ContainerRuntime, ContainerRuntimeOptions } from './container/middleware.js';

// http
export { getUserProtocol } from './http/user-protocol.js';
export type { IUserProtocol } from './http/user-protocol.js';
export { getAppInfo } from './http/app-info.js';
export type { AppInfo } from './http/app-info.js';
export { resolveAppEnv, isProductionEnv } from './http/app-env.js';
export type { AppEnv } from './http/app-env.js';
export { HttpStatus } from './http/http-status.js';
export { createHttpErrorHandler, notFoundHandler, HTTP_ERROR_PHRASES } from './http/http-error.js';
export type { HttpErrorHandlerOptions, ErrorReportContext, ErrorReporter } from './http/http-error.js';
export { findMysqlDriverError, logMysqlDriverError } from './http/mysql-driver-error.js';
export type { MysqlDriverErrorLike } from './http/mysql-driver-error.js';
export { createQueryFailedErrorHandler, classifyGenericMysqlDriverError } from './http/query-failed-error.js';
export type {
  ClassifiedDbError,
  QueryFailedClassifier,
  QueryFailedErrorHandlerOptions,
} from './http/query-failed-error.js';
export { createAppErrorHandler } from './http/app-error-handler.js';
export type { CreateAppErrorHandlerOptions } from './http/app-error-handler.js';
export { normalizeTrailingSlash } from './http/trailing-slash.js';
export type { ExecutionContextLike } from './http/execution-context.js';
export { defaultDefer, createWaitUntilDefer } from './http/defer.js';
export type { DeferExecutor } from './http/defer.js';
export { createSentryErrorReporter } from './http/http-error.js';
export type { SentryExceptionReporterLike } from './http/http-error.js';

// cache
export { KVCache } from './cache/kv-cache.js';
export type { KVNamespace, KVCacheOptions } from './cache/kv-cache.js';

// stripe
export { createStripeClient, verifyStripeWebhook } from './stripe/client.js';
export type { CreateStripeClientOptions } from './stripe/client.js';
export {
  extractStripeFailureReason,
  stripeFailureMessageJa,
  serializePaymentFailure,
  parsePaymentFailure,
  PaymentDeclinedError,
  toPaymentDeclinedError,
} from './stripe/failure.js';
export type {
  StripeFailureReason,
  PaymentFailureSource,
  PaymentFailureRecord,
  PaymentFailureReason,
  IapFailureReason,
  PaymentDeclinedBody,
} from './stripe/failure.js';
export { classifyStripeReconcile } from './stripe/reconcile.js';
export type { StripeReconcileAction } from './stripe/reconcile.js';

// payment (provider-agnostic; web-standard only). reopenGuardedPaymentFailedSet is drizzle-based → './db'.
export { paymentFailureMessageJa, iapFailureKey, UNRESOLVED_PAYMENT_STATUSES } from './payment/failure.js';
export type { PaymentFailureStatus, PaymentFailureType } from './payment/failure.js';

// in-app purchase (Apple / Google)
export { classifyAppleRenewal, verifyAppleReceipt } from './iap/apple.js';
export type {
  AppleRenewalClassification,
  AppleRenewalState,
  AppleVerifyReceiptResponse,
  ApplePendingRenewalInfo,
  AppleLatestReceiptInfo,
} from './iap/apple.js';
export { classifyGoogleSubscription, getGoogleSubscription, googleAccessToken } from './iap/google.js';
export type {
  GoogleSubscriptionClassification,
  GoogleSubscriptionState,
  GoogleSubscriptionPurchase,
  GoogleOAuthCredentials,
} from './iap/google.js';

// db
export { retryWhenDeadlock } from './db/retry.js';

// queue
export { sendInChunks } from './queue/send.js';
export type { QueueLike, QueueSendMessage } from './queue/send.js';
export { processBatch } from './queue/consumer.js';
export type { QueueMessageLike, MessageBatchLike, ProcessBatchOptions, ProcessBatchResult } from './queue/consumer.js';
export { createQueueErrorHandler } from './queue/error-handler.js';
export type { CreateQueueErrorHandlerOptions } from './queue/error-handler.js';

// ai
export { createAiGatewayProvider } from './ai/gateway.js';
export type {
  AiGatewayConfig,
  AiGatewayProvider,
  AiGatewayBinding,
  AiGateway,
  AiGatewayOptions,
} from './ai/gateway.js';

// aws
export { getAuthenticationSecret } from './aws/secrets-manager.js';
export type { AwsSecretsOptions } from './aws/secrets-manager.js';
export { getCloudFrontSignedUrl } from './aws/cloudfront.js';
export { getTemporaryCredentials } from './aws/sts.js';
export type { GetTemporaryCredentialsOptions, StsCredentials } from './aws/sts.js';

// firebase
export type { DecodedIdToken, FirebaseVerifier } from './firebase/firebase-verifier.js';
export { JoseFirebaseVerifier, SECURETOKEN_JWK_URL } from './firebase/jose-firebase-verifier.js';
export { IdentityToolkit } from './firebase/identity-toolkit.js';
export type { ServiceAccount } from './firebase/identity-toolkit.js';
export { createRemoteFirebaseVerifier, createServiceAccountVerifier } from './firebase/remote-verifier.js';
