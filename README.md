# @rdlabo/workers-hono-kit

Infrastructure toolkit for building APIs on [Hono](https://hono.dev) + [Cloudflare Workers](https://workers.cloudflare.com).

It provides the building blocks a NestJS-style API needs but that don't run on `workerd` (no Node.js AWS SDK, no `firebase-admin`), plus middleware that matches Express / NestJS response semantics byte-for-byte:

- **Firebase ID-token verification** on Workers via [`jose`](https://github.com/panva/jose) (RS256 against Google's securetoken JWKS), with optional Identity Toolkit REST for `getUser` / `deleteUser`.
- **AWS Secrets Manager / STS AssumeRole / CloudFront signed URLs** via SigV4-signed `fetch` ([`aws4fetch`](https://github.com/mhart/aws4fetch)) or Web Crypto — no AWS SDK.
- **Middleware**: `finalizeResponse` (Express-compatible weak ETag + JSON charset), `validate` (NestJS `ValidationPipe`-shaped 400), and zod number-coercion helpers.
- **Standard API errors**: `createHttpErrorHandler` / `notFoundHandler` / `HttpStatus`.
- **Deadlock retry** (`ER_LOCK_DEADLOCK` exponential backoff) and an optional **MySQL data layer** (`@rdlabo/workers-hono-kit/db`) for Hyperdrive + Drizzle.
- **AI Gateway**: route `@ai-sdk` models through the Cloudflare AI Gateway.
- **Stripe** Workers-native client + async webhook verification.
- **Testing helpers** (`@rdlabo/workers-hono-kit/testing`): a Drizzle-migration-backed test database, in-memory Firebase fake, configurable test doubles, and Stripe fixtures.

## Install

```bash
npm install @rdlabo/workers-hono-kit
```

Peer dependencies — install the ones you use:

```bash
# Core (root export)
npm install hono zod @hono/zod-validator jose aws4fetch

# Optional, only if you use the corresponding feature:
npm install drizzle-orm mysql2        # ./db and ./testing
npm install ai ai-gateway-provider    # createAiGatewayProvider
```

`stripe` is bundled as a direct dependency, so the Stripe helpers work without an extra install.

> **Compiled ESM, with types.** The package is published as compiled ES modules (`./dist/*.js`) plus
> declaration files (`./dist/*.d.ts`) via the `exports` field. It depends only on Web-standard APIs
> (`fetch`, `crypto.subtle`, `Response`) available on Cloudflare Workers (`workerd`) and other edge
> runtimes, and requires Node.js ≥ 20 for tooling. Four entry points are exposed:
>
> | Subpath | Import | Use |
> | --- | --- | --- |
> | `.` | `@rdlabo/workers-hono-kit` | Web-standard helpers (middleware, HTTP, Firebase, AWS, AI, Stripe, KV). |
> | `./db` | `@rdlabo/workers-hono-kit/db` | MySQL data layer (mysql2 + Drizzle). |
> | `./business-time` | `@rdlabo/workers-hono-kit/business-time` | JST business-time API (`toBusinessDateTime` / `normalizeBusinessDate` / `formatBusinessDateTime`, etc.). |
> | `./testing` | `@rdlabo/workers-hono-kit/testing` | Test helpers (mysql2 + Drizzle + fakes/fixtures). |

## API

### Root — `@rdlabo/workers-hono-kit`

| Export | Description |
| --- | --- |
| `finalizeResponse()` | Middleware that adds an Express-compatible weak `ETag` and JSON `charset=utf-8`. |
| `validate(target, schema, options?)` | Zod validator → NestJS `ValidationPipe`-shaped `400` (`{ statusCode, message[], error }`). `options.onValidationError(err, c)` to report (e.g. Sentry). |
| `createValidate({ sentry? })` | Bound `validate` factory. Pass `sentry` on Sentry apps; omit for console-only (review, cbs-ai). |
| `createSentryValidate(sentry)` | **Deprecated** — use `createValidate({ sentry })`. |
| `zNum` / `zNumWithDefault` / `zNumOptional` / `zNumNullable` | Number-coercion zod schemas (mirror class-transformer `@Transform`). |
| `getAuthenticationSecret<T>(options, secretId)` / `AwsSecretsOptions` | Fetch a secret from AWS Secrets Manager (SigV4 `fetch`, per-isolate cache). |
| `getTemporaryCredentials(options)` / `GetTemporaryCredentialsOptions` / `StsCredentials` | STS `AssumeRole` via SigV4 `fetch` (global `sts.amazonaws.com`); returns temporary credentials for browser S3 uploads. |
| `getCloudFrontSignedUrl(url, privateKeyPem, keyPairId, dateLessThan)` | CloudFront signed URL (canned policy, RSA-SHA1, URL-safe base64) — Web Crypto reimpl of `@aws-sdk/cloudfront-signer`, byte-identical query order. |
| `JoseFirebaseVerifier` / `FirebaseVerifier` / `DecodedIdToken` | Firebase ID-token verification (`verifyIdToken`, `getUser`, `deleteUser`). |
| `createRemoteFirebaseVerifier(projectId)` | Convenience factory: production verifier with a cached remote JWKS (verification only). |
| `createServiceAccountVerifier(serviceAccountJson)` | Cached verifier built from a service-account JSON, **with `IdentityToolkit`** (getUser/deleteUser). One per isolate, re-created only when the SA JSON changes. |
| `IdentityToolkit` / `ServiceAccount` / `SECURETOKEN_JWK_URL` | Identity Toolkit REST client + constants for `getUser` / `deleteUser`. |
| `retryWhenDeadlock(fn, retries?, delay?)` | Retry on MySQL `ER_LOCK_DEADLOCK` with exponential backoff. |
| `getUserProtocol(c)` / `IUserProtocol` | Read client IP / UA (`CF-Connecting-IP` → `X-Forwarded-For`). |
| `getAppInfo(c)` / `AppInfo` | Read `x-amz-meta-version` / `x-amz-meta-uuid`. |
| `resolveAppEnv(env)` / `isProductionEnv(env)` / `AppEnv` | Resolve `'development'` / `'production'` from `env.APP_ENV` (defaults to `'production'` for safety). |
| `HttpStatus` | HTTP status enum identical to NestJS `@nestjs/common`. |
| `createHttpErrorHandler(options?)` / `HttpErrorHandlerOptions` | `app.onError()` handler that maps a thrown `HTTPException` to `{ statusCode, message, error? }` (`401` omits `error`). Optional custom error predicate and unhandled-error report hook. Unhandled errors log via `console.error` (mysql2 errors include `sqlMessage` / `errno` when detectable). |
| `createAppErrorHandler(options?)` / `CreateAppErrorHandlerOptions` | Standard `app.onError`: {@link createQueryFailedErrorHandler} + default {@link classifyGenericMysqlDriverError} + optional `sentry` (Sentry apps), `getReportError` / `reportError` (tests / container), or neither (no external reporting). |
| `createQueryFailedErrorHandler(options)` / `QueryFailedClassifier` / `ClassifiedDbError` | Lower-level compose when you need full control over `classify` + `onUnhandledError` without defaults. |
| `classifyGenericMysqlDriverError(err)` | Default classifier: any mysql2 driver error → `{ statusCode: 500, message: 'Internal server error' }`; non-DB errors → `null`. |
| `findMysqlDriverError(err)` / `logMysqlDriverError(err, statusCode)` | Low-level mysql2 driver-error detection (follows `err.cause`) and structured logging. For custom classifiers (e.g. odss). |
| `notFoundHandler(c)` | `app.notFound()` handler with `{ message: 'Cannot METHOD path', error, statusCode }` 404 body. |
| `normalizeTrailingSlash(request)` | Strip trailing slash(es) from the request URL before routing (Express/Nest parity). Does **not** 301-redirect — preserves POST/PUT/DELETE bodies. |
| `HTTP_ERROR_PHRASES` | `{ 400, 401, 403, 404 }` → standard `error` field phrases. |
| `createAuthMiddleware(options)` / `AuthMiddlewareOptions` | Factory for a Firebase-token auth middleware: reads the token header, verifies, resolves the DB user id, and stashes the result on the context. Omit `resolveUserId` for a token-only (login) guard. |
| `perfLog(options?)` / `PerfLogOptions` / `AnalyticsEngineDatasetLike` | Middleware that records one per-request latency data point (`t_app`, colo, cold/warm, route, status) and emits it to **Workers Logs** (`console.log`) and/or **Workers Analytics Engine** (`writeDataPoint`). Lets you measure low-traffic Workers without a live `wrangler tail`. |
| `ErrorReporter` / `ErrorReportContext` | Types for a `reportError`-style unhandled-error reporter (e.g. wired to Sentry), paired with `createHttpErrorHandler`'s `onUnhandledError`. |
| `createSentryErrorReporter(sentry)` / `SentryExceptionReporterLike` | Build an `ErrorReporter` that forwards to Sentry with an optional `request_id` tag (no hard `@sentry/cloudflare` dependency). |
| `DeferExecutor` / `defaultDefer` / `createWaitUntilDefer(ctx)` | Fire-and-forget executor for Workers: `defaultDefer` swallows rejections (tests); `createWaitUntilDefer` registers work via `ctx.waitUntil`. |
| `createAiGatewayProvider(config)` / `AiGatewayConfig` / `AiGatewayProvider` | Route `@ai-sdk` models through the Cloudflare AI Gateway, via either a Workers `AI` binding or REST credentials (`accountId` / `gateway` / `token`). |
| `KVCache` / `KVNamespace` / `KVCacheOptions` | Workers-KV cache-aside helper (key `appName+version+table_type_column`, sha256 for string ids, TTL clamped ≥60s). Set `appName` / `version` per application. |
| `createStripeClient(secret, opts?)` / `verifyStripeWebhook(...)` / `CreateStripeClientOptions` | Workers-native Stripe client (fetch transport) + async webhook verification (SubtleCrypto). `apiVersion` optional (pin to a fixed Stripe API version). |
| `sendInChunks(queue, messages, options?)` / `QueueLike` / `QueueSendMessage` | Send queue messages in bounded chunks to stay under the Workers subrequest cap per invocation. `options.chunkSize` sets the per-batch size (defaults to and is capped at 100). |
| `processBatch(batch, handler, options?)` / `MessageBatchLike` / `QueueMessageLike` / `ProcessBatchOptions` / `ProcessBatchResult` | Process a queue batch with bounded concurrency (consumer-side counterpart to `sendInChunks`). |
| `createQueueErrorHandler(options)` / `CreateQueueErrorHandlerOptions` | Factory for `processBatch`'s `onError`: logs every failure; optional Sentry capture with queue/message context; optional `maxRetries` gate (report only on final attempt). |
| `ExecutionContextLike` | Minimal `waitUntil`-only Workers execution context shape (for `withMysqlConnections` in worker entry modules without importing `./db`). |

### Data layer — `@rdlabo/workers-hono-kit/db`

Requires the `drizzle-orm` and `mysql2` peers. Reads run against a replica via raw SQL; writes/transactions run against the primary through the Drizzle ORM with deadlock retry. The kit deliberately does not depend on the ORM's type identity — you pass the Drizzle instance in.

| Export | Description |
| --- | --- |
| `createHyperdriveDatabase(options)` | `DisposableDatabase` that lazily opens primary/replica connections from Hyperdrive bindings per request; `dispose()` closes them. |
| `createMysqlDatabase(options)` | Assemble a `Database` from an already-connected Drizzle ORM + replica `QueryRunner`. |
| `databaseFrom(orm, replica)` | Build a `Database` from an existing Drizzle instance + replica handle. |
| `Database` / `DisposableDatabase` / `QueryRunner` / `TxOf` | The `read` / `write` / `transaction` API and its supporting types. |
| `hyperdriveConnectionOptions(hyperdrive, overrides?)` / `HyperdriveLike` / `ExecutionContextLike` | Build mysql2 `createConnection` options from a Hyperdrive binding (`disableEval`, `decimalNumbers`, `timezone '+09:00'` by default). `ExecutionContextLike` is the same type as the root export, re-exported here so `withMysqlConnections` callers don't need the root import. |
| `withMysqlConnections(...)` | Open primary/replica connections, run a function, close them in `finally` (via `ctx.waitUntil`). |
| `retryWhenDeadlock(fn, retries?, delay?)` | Same deadlock-retry helper as the root export. |
| `insertIdOf` / `affectedRowsOf` / `insertedIdsOf` / `DzWriteResult` | Extract `insertId` / `affectedRows` (and derive contiguous bulk-insert ids) from a mysql2 write result. |
| `toJstDate` / `jstTimestampParams` / `jstDatetimeParams` / `jstDateParams` | JST date/time normalization params (advanced use). |
| `MYSQL_TIMEZONE` | Default mysql2 connection `timezone` (`'+09:00'`) for the JST DB deployment. |
| `jstTimestamp` / `jstDatetime` / `jstDate` / `decimalNumber` | Drizzle column helpers (no repo-side wrapper needed). |
| `jstOnUpdateNow` | SQL expression for `ON UPDATE CURRENT_TIMESTAMP`. The `jstTimestamp` customType (and friends) do not support `.onUpdateNow()`, so pair it with `.$onUpdateFn(() => jstOnUpdateNow(fsp))`. |
| `coerceDecimalNumber` / `decimalNumberParams` | DECIMAL normalization params (the `decimalNumber` column helper is usually enough). |
| `DRIZZLE_ORM_OPTIONS` / `honoDrizzleConfig(options)` / `HonoDrizzleConfigOptions` | Shared Drizzle casing (`snake_case`) for both the runtime `drizzle()` call and `drizzle.config.ts`, keeping config ↔ runtime in sync. |
| `resolveDbSecret()` / `ResolvedDbSecret` | Resolve DB connection info from the `DB_SECRET` env var (an AWS RDS managed-secret JSON string) for CI migrate / local tooling. Returns `undefined` when `DB_SECRET` is unset; throws on invalid JSON or a missing required key. |
| `baselineMigrations(options)` / `readBaselineEntry(migrationsFolder)` / `BaselineMigrationsOptions` / `BaselineResult` / `BaselineEntry` | Brownfield first-deploy helper: mark an existing `0000_*` migration as applied without re-running DDL. |

#### Drizzle column helpers (`jstTimestamp` / `decimalNumber`, etc.)

- `drizzle-orm` is a **peer** only. The kit does not include `drizzle-orm` as a dependency (even after publishing, it uses the consumer's single copy).
- The consumer just keeps `drizzle-orm` in its `dependencies` as usual. **No `overrides` in `package.json` are needed.**
- The npm-published artifact contains no `devDependencies`, so installing it does not add a kit-specific `drizzle-orm` (there is only the one peer copy).
- The column helpers `import` the consumer's `drizzle-orm` at runtime, and the types are the `customType` inference as-is (`MySqlCustomColumnBuilder<…>`). No `any` is used, so the column's semantic type propagates to the consumer table's `$inferSelect`.
- **Precondition: resolve drizzle to a single copy.** Drizzle's `SQL` is a **nominal** type carrying a private field `shouldInlineParams`, so if the kit and the consumer resolve different copies, `jstTimestamp(…).default(sql\`…\`)` fails the whole schema with `TS2345 separate declarations of a private property 'shouldInlineParams'`. Under `file:`-link development, `drizzle-orm` nests under the kit and becomes a second copy, so **pin `drizzle-orm` to the consumer's own single copy in `tsconfig.json`**:

  ```jsonc
  // tsconfig.json compilerOptions (merge with existing paths if any)
  "paths": {
    "drizzle-orm": ["./node_modules/drizzle-orm"],
    "drizzle-orm/*": ["./node_modules/drizzle-orm/*"]
  }
  ```

  With `moduleResolution: "Bundler"`, `baseUrl` is not required (if `baseUrl` is already set, drop the leading `./`). On the published package (a single copy) these `paths` are harmless. **No `overrides` needed.**
- When developing against the kit via a direct `file:` link, run `npm install` in the kit repo itself to satisfy its peers (do not add `overrides` on the consumer side).

**`CURRENT_TIMESTAMP` vs the connection `timezone:'+09:00'`**

| Path | Who decides the time | Relationship to JST |
| --- | --- | --- |
| The app binds a `Date` (INSERT/UPDATE) | mysql2 + connection `timezone:'+09:00'` | Treated as JST on the wire (`datetime-wire` test) |
| `DEFAULT CURRENT_TIMESTAMP` / `ON UPDATE CURRENT_TIMESTAMP` | The MySQL server (session `time_zone`) | A **separate path** from the connection option. JST if the RDS `time_zone` is `+09:00`, UTC if UTC |

`jstTimestamp` / `jstDatetime` only handle read/write pass-through and DATE normalization; they do not change the timezone of server-side defaults. For columns that need `ON UPDATE`, keep the DDL intent with `.$onUpdateFn(() => jstOnUpdateNow(6))`.

### Business time — `@rdlabo/workers-hono-kit/business-time`

String-level JST business-time conversions (Workers UTC instant ↔ business calendar date / date-time),
with **no `mysql2` / `drizzle-orm` dependency**. This is a different layer from the `./db` column helpers
(which handle the MySQL wire format): the DB stays on JST, and the app handles JST explicitly through
this module instead of relying implicitly on the connection `timezone`.

| Export | Description |
| --- | --- |
| `today(ref?)` | The JST business calendar date (`YYYY-MM-DD`) of `ref` (defaults to now). |
| `toBusinessDate(instant)` | UTC instant → JST business calendar date (`YYYY-MM-DD`). |
| `normalizeBusinessDate(value)` | Normalize a `string` / `Date` / nullish to `YYYY-MM-DD`; a `YYYY-MM-DD` string passes through unchanged, nullish/empty/invalid → `null`. |
| `toBusinessDateTime(instant)` | UTC instant → JST business date-time (`YYYY-MM-DD HH:mm:ss`). |
| `parseBusinessDateTime(value)` | JST business date-time string → UTC instant (accepts a space or `T` separator). |
| `formatBusinessDateTime(instant, pattern?)` | Format an instant in the business TZ (Nest `helper.formatDate`-compatible tokens). |
| `startOfBusinessDay(date)` / `endOfBusinessDay(date)` | UTC instant of `00:00:00` / `23:59:59` on a JST business date. |
| `businessDateTimeInstant(date, time)` | JST business date + wall-clock time → UTC instant. |
| `addBusinessDays(date, days)` | Add calendar days to a JST business date. |
| `ageOnBusinessDate(birthDate, asOfDate?)` | Full years of age on a business date (`asOfDate` defaults to `today()`). |
| `DEFAULT_BUSINESS_DATETIME_PATTERN` | Default `formatBusinessDateTime` pattern (`YYYY-MM-DDThh:mm:ss`). |
| `BUSINESS_TIMEZONE` / `BusinessDate` / `BusinessDateTime` | JST timezone constant and the business-date / date-time string types. |

```ts
import {
  toBusinessDate,
  toBusinessDateTime,
  formatBusinessDateTime,
  addBusinessDays,
} from '@rdlabo/workers-hono-kit/business-time';

const now = new Date('2026-07-05T21:00:00Z');
toBusinessDate(now); // '2026-07-06' (JST)
toBusinessDateTime(now); // '2026-07-06 06:00:00'
formatBusinessDateTime(now); // '2026-07-06T06:00:00'
addBusinessDays('2026-07-06', 3); // '2026-07-09'
```

### Testing — `@rdlabo/workers-hono-kit/testing`

Requires the `drizzle-orm` and `mysql2` peers. Consolidates duplicated test boilerplate.

| Export | Description |
| --- | --- |
| `createTestDb(options)` / `TestDb` / `CreateTestDbOptions` / `TestDbConnection` | Test database built from committed Drizzle migrations as the single source of truth: `resetSchema` / `createTestPool` / `truncateAll` / `seed` / `mysqlReachable`. |
| `FakeFirebaseVerifier` | In-memory `FirebaseVerifier` for offline route tests (`register` / `verifyIdToken` / `getUser` / `deleteUser`). |
| `createPoolDatabase(options)` / `CreatePoolDatabaseOptions` | A `Database` backed by a single pool used as both primary and replica. |
| `createNoopDatabase()` | A `Database` stub that throws on `write` / `transaction` to catch accidental DB use in DB-less routes. |
| `authHeaders(token, opts?)` | Build interceptor-compatible auth headers for requests. |
| `registerFirebaseToken(firebase, uid, record?, token?)` | Register a token in a `FakeFirebaseVerifier` (no DB). |
| `provisionUser(pool, firebase, opts)` | Register a token and provision a conventional `users(id, firebase_uid, agree)` row; returns the user id (idempotent). |
| `configurableFake(impl, name?)` | Build a test double from a partial implementation; un-stubbed members throw `"${name}.${method} not configured"`. |
| `fakeApiList` / `fakePaymentIntent` / `fakeStripeEvent` / `fakeCheckoutSession` / `fakeCustomer` / `fakePrice` / `fakeSubscription` | Stripe object fixtures with sensible defaults, overridable per test. |
| `fakeKv()` / `fakeQueue()` / `FakeQueue` | In-memory Workers KV / Queues producer doubles (`sent` + `batchCount` on queues for subrequest-bound assertions). |

## Usage

### Response finalization (ETag / charset)

```ts
import { Hono } from 'hono';
import { finalizeResponse } from '@rdlabo/workers-hono-kit';

const app = new Hono();
app.use('*', finalizeResponse());
```

### Request validation

```ts
import { validate } from '@rdlabo/workers-hono-kit';
import { z } from 'zod';

app.post('/users', validate('json', z.object({ name: z.string() })), (c) => {
  const body = c.req.valid('json'); // typed & validated
  return c.json(body, 201);
});

// Report validation failures (response is unchanged):
validate('json', schema, {
  onValidationError: (err, c) => Sentry.captureException(err),
});
```

`param` / `query` values arrive as strings — coerce numbers with the zod helpers:

```ts
import { zNum, zNumOptional } from '@rdlabo/workers-hono-kit';

const Params = z.object({ id: zNum(z.number().int()), page: zNumOptional() });
```

### Firebase ID-token verification

```ts
import { createRemoteFirebaseVerifier } from '@rdlabo/workers-hono-kit';

const verifier = createRemoteFirebaseVerifier(projectId);
const decoded = await verifier.verifyIdToken(idToken); // { uid, email, ... }
```

With `getUser` / `deleteUser` (needs a service account):

```ts
import { createRemoteJWKSet } from 'jose';
import { JoseFirebaseVerifier, IdentityToolkit, SECURETOKEN_JWK_URL } from '@rdlabo/workers-hono-kit';

const verifier = new JoseFirebaseVerifier({
  projectId,
  keyResolver: createRemoteJWKSet(new URL(SECURETOKEN_JWK_URL)),
  identity: new IdentityToolkit(serviceAccount),
});
```

### AWS Secrets Manager

```ts
import { getAuthenticationSecret } from '@rdlabo/workers-hono-kit';

interface MySecret {
  firebaseProduction: string;
  stripeSecret: string;
}

const secret = await getAuthenticationSecret<MySecret>(
  {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: 'ap-northeast-1',
  },
  'myapp/secret',
);
```

### STS AssumeRole (browser S3 uploads)

```ts
import { getTemporaryCredentials } from '@rdlabo/workers-hono-kit';

const credentials = await getTemporaryCredentials({
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  roleArn: 'arn:aws:iam::123456789012:role/s3-put-app-only-role',
  roleSessionName: `session-${userId}-${Date.now()}`,
});
// Return credentials to the browser; PutObject uses @aws-sdk/client-s3 with AccessKeyId / …
```

### Deadlock retry & HTTP helpers

```ts
import { retryWhenDeadlock, getUserProtocol, getAppInfo, HttpStatus } from '@rdlabo/workers-hono-kit';

await retryWhenDeadlock(() => db.transaction(/* ... */));

const { ipAddress, userAgent } = getUserProtocol(c);
const appInfo = getAppInfo(c);
return c.json(body, HttpStatus.CREATED);
```

### HTTP error / 404 handlers

`createHttpErrorHandler()` renders a thrown `HTTPException` as standard API error JSON,
and `notFoundHandler` gives the default unmatched-route 404 body.

#### App entry (fleet standard)

Use a **singleton** Hono app and inject the request-scoped container in middleware — do **not**
call `createApp(container).fetch(...)` on every request (rebuilds the route graph each time).

```ts
// worker.ts — once per isolate
const app = createApp();
export default Sentry.withSentry(/* … */, {
  fetch: (req, env, ctx) => app.fetch(req, env, ctx),
});

// app.ts — fleet-standard onError (Sentry optional)
import * as Sentry from '@sentry/cloudflare';
import { createAppErrorHandler } from '@rdlabo/workers-hono-kit';

app.onError(
  createAppErrorHandler({
    sentry: Sentry, // omit on repos without Sentry (airlec, review, cbs-ai)
    getReportError: (c) => c.get('container')?.reportError, // tests + scheduled paths
  }),
);

// odss-mobile: add classify: classifyQueryFailed (repo parity)
// winecode: sentry + isHttpError in errors.ts (no container middleware)
// foodlabel: sentry + reportError: container.reportError (per-request container closure)
```

Reference: `winecode/hono` (singleton + container middleware). Legacy repos still using
per-request `createApp(container)` should migrate to this shape where possible.

**Isolate-scoped memo + container runtime** (shared across the fleet):

```ts
import { createContainerRuntime, createIsolateMemo } from '@rdlabo/workers-hono-kit';

// Secrets / env: cache successes per isolate; rejections are NOT cached (retry on next request).
const resolveSecrets = createIsolateMemo(async (env: Env) => { /* SM or env vars */ });

const { middleware: containerMiddleware, withContainer } = createContainerRuntime<Env, Container>({
  hyperdrives: (env) => ({ primary: env.HYPERDRIVE_PRIMARY, replica: env.HYPERDRIVE_REPLICA }),
  createContainer: async ({ env, executionCtx, primary, replica }) => {
    const secret = await resolveSecrets(env);
    return buildContainer({ /* db from primary/replica, secret, … */ });
  },
});
```

Use `withContainer` from `scheduled` / `queue` handlers; use `containerMiddleware` in `createApp`.

```ts
import { createHttpErrorHandler, notFoundHandler } from '@rdlabo/workers-hono-kit';

app.notFound(notFoundHandler);

// Prefer createAppErrorHandler (see "App entry" above). Lower-level only when needed:
app.onError(createHttpErrorHandler());
```

**Important:** `Sentry.withSentry` does **not** capture errors handled by `app.onError`. Pass `sentry`
to `createAppErrorHandler` (or wire `getReportError` / `reportError` for tests and scheduled paths).

Repos with a custom DB error classifier (e.g. odss-mobile) pass `classify` to
`createAppErrorHandler` — do not call `createQueryFailedErrorHandler` directly unless you need full control.

### Auth middleware

Encodes the shared skeleton (read token header → verify → `getAppInfo` → resolve user id →
set context, with `console.error` + a configurable failure on error). Inject your own
verify/resolver, context-variable names, and failure mode.

`createAuthMiddleware<Env, Verified, Id>` is generic over your Hono `Env`, so `c.set(...)` in
`setContext` is type-checked against your `Variables`.

```ts
import { createAuthMiddleware } from '@rdlabo/workers-hono-kit';

// AuthGuard: verify + resolve (and provision) the DB user id.
const userAuth = createAuthMiddleware<AppEnv, UserRecord, number>({
  verify: (token) => container.firebase.verifyIdToken(token),
  resolveUserId: (record, _c, appInfo) =>
    container.auth.getUserIdFromFirebase(record, appInfo).catch(() => container.auth.createUser(record)),
  setContext: (c, { verified, appInfo, userId }) => {
    c.set('userRecord', verified);
    c.set('userId', userId);
    c.set('appInfo', appInfo);
  },
});

// TokenGuard (login): verify only — omit resolveUserId. Override the failure if needed.
const tokenAuth = createAuthMiddleware<AppEnv, UserRecord>({
  verify: (token) => container.firebase.verifyIdToken(token),
  setContext: (c, { verified }) => c.set('userRecord', verified),
  onFailure: (_e, c) => c.json({ message: 'Unauthorized', statusCode: 401 }, 401),
});
```

### Latency instrumentation (`perfLog`)

Records one data point per request — `t_app` (time inside the app), `colo`, `cold`/`warm`, matched
route, `status` — and ships it to **Workers Logs** and/or **Workers Analytics Engine**. This lets you
measure a low-traffic Worker after the fact (retained + queryable) instead of watching a live
`wrangler tail`. Register it first so it wraps everything.

```ts
import { perfLog } from '@rdlabo/workers-hono-kit';

// A) app served with env (`app.fetch(req, env, ctx)`): bare — reads `PERF` (Analytics Engine
//    dataset binding) and `PERF_LOG === '1'` (Workers Logs) off `c.env`.
app.use('*', perfLog());

// B) bindings not on Hono env (legacy per-request createApp): pass explicitly — prefer fleet
//    standard singleton app + container middleware so env is always on `c.env`.
app.use('*', perfLog({ console: env.PERF_LOG === '1', dataset: env.PERF }));
```

```toml
# wrangler.toml — dataset is created on first write (no provisioning); needs [observability] for Logs.
[[analytics_engine_datasets]]
binding = "PERF"
dataset = "myapp_perf"
```

Query percentiles by route/colo with the Analytics Engine SQL API:

```sql
SELECT blob1 AS path, blob2 AS colo,
       quantileWeighted(0.5)(double1, _sample_interval) AS p50,
       quantileWeighted(0.9)(double1, _sample_interval) AS p90
FROM myapp_perf WHERE timestamp > now() - INTERVAL '7' DAY
GROUP BY path, colo ORDER BY p90 DESC
```

> **Scope of `t_app`**: it covers everything *inside* the app; work done in `fetch` *before* the app
> (e.g. secrets fetch / DB connect in container middleware vs. building the container in `worker.fetch`) is
> not comparable across differently-wired apps. Instrument the `fetch` seam if you need a secrets/connect
> cold breakdown. On production Workers `Date.now()` only advances at I/O boundaries, so `t_app` ≈ I/O
> wait, not CPU time.

### AI Gateway

Route `@ai-sdk` models through the Cloudflare AI Gateway — either with a Workers `AI` binding
(production / `wrangler dev`) or with REST credentials (non-Workers contexts).

```ts
import { createAiGatewayProvider } from '@rdlabo/workers-hono-kit';
import { openai } from '@ai-sdk/openai';

// Binding form (Workers):
const provider = createAiGatewayProvider({ binding: env.AI.gateway('my-gateway') });

// REST form (anywhere):
const rest = createAiGatewayProvider({
  accountId: env.CF_ACCOUNT_ID,
  gateway: 'my-gateway',
  token: env.CF_AIG_TOKEN,
});

const model = provider.aigateway(openai('gpt-4o-mini'));
```

### MySQL data layer (Hyperdrive + Drizzle)

```ts
import { createHyperdriveDatabase, hyperdriveConnectionOptions } from '@rdlabo/workers-hono-kit/db';
import { drizzle } from 'drizzle-orm/mysql2';
import { DRIZZLE_ORM_OPTIONS } from '@rdlabo/workers-hono-kit/db';

const db = createHyperdriveDatabase({
  primaryHyperdrive: env.HYPERDRIVE,
  replicaHyperdrive: env.HYPERDRIVE_REPLICA,
  createOrm: (conn) => drizzle(conn, { ...DRIZZLE_ORM_OPTIONS, schema }),
});

try {
  const rows = await db.read('SELECT * FROM users WHERE id = ?', [id]); // replica, raw SQL
  await db.write((dz) => dz.insert(users).values({ name })); // primary, deadlock-retried
} finally {
  await db.dispose();
}
```

### KV cache

```ts
import { KVCache } from '@rdlabo/workers-hono-kit';

const cache = new KVCache(env.CACHE, { appName: 'myapp' }); // version prefix defaults to 'v8_'
await cache.set('users', 'byId', userId, user, 600);
const hit = await cache.get<User>('users', 'byId', userId);
```

### Stripe (Workers-native)

```ts
import { createStripeClient, verifyStripeWebhook } from '@rdlabo/workers-hono-kit';

const stripe = createStripeClient(secret); // or { apiVersion: '2024-04-10' } to pin
const event = await verifyStripeWebhook(secret, webhookSecret, rawBody, c.req.header('stripe-signature') ?? '');
```

### Testing

```ts
import { createTestDb, FakeFirebaseVerifier, configurableFake } from '@rdlabo/workers-hono-kit/testing';

const testDb = createTestDb({ dbName: 'myapp_test', migrationsFolder: './drizzle' });
await testDb.resetSchema();
const pool = testDb.createTestPool();

const firebase = new FakeFirebaseVerifier();
firebase.register('token-1', { uid: 'uid-1', email: 'a@example.com' });

const gateway = configurableFake<PaymentGateway>({ charge: async () => ({ ok: true }) }, 'PaymentGateway');
```

## Local development / linking

If you consume this package via a local path (e.g. `"@rdlabo/workers-hono-kit": "../../hono-kit"`) rather than from npm, TypeScript and esbuild resolve the package's bare imports from *its own* `node_modules`, which can create a second `zod` instance. That breaks types where your zod-inferred values flow into other libraries (e.g. Drizzle inserts). Dedupe with tsconfig `paths`:

```jsonc
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "zod": ["node_modules/zod"],
      "zod/*": ["node_modules/zod/*"],
      "@hono/zod-validator": ["node_modules/@hono/zod-validator"]
    }
  }
}
```

When installed from npm normally, package managers dedupe `zod` to a single copy and this is not needed.

## CLI

The package ships three `bin` commands (run via `npx` or an npm script in the consuming app):

| Command | Use |
| --- | --- |
| `workers-hono-kit-sync-dev-aws <wrangler-args…>` | Launch `wrangler` with AWS credentials injected as `--var`, resolved from the active AWS profile (honors `AWS_PROFILE`, supports short-lived SSO/temporary creds). Nothing is written to disk — replaces `.dev.vars`. Wire it as the `dev` script, e.g. `AWS_PROFILE=<p> workers-hono-kit-sync-dev-aws dev --var APP_ENV:development`. |
| `workers-hono-kit-check-subrequest-fanout [dir…]` | CI gate that greps for per-item external-call fan-outs (`runWithConcurrency(` / `PromisePool` / `.withConcurrency(`) that would eventually exceed the Workers subrequest cap. Annotate a genuinely-safe site with `subrequest-ok`. Scans `src` by default; exits 1 on an un-annotated marker. |
| `workers-hono-kit-db-baseline [--migrations ./drizzle]` | Brownfield first-deploy helper: record the baseline `0000` migration as *already applied* on an existing MySQL DB without running its DDL (the CLI wrapper around `baselineMigrations` / `readBaselineEntry`). Reads DB credentials from `DB_SECRET` (AWS RDS managed secret) or the individual `DB_*` env vars. |

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest
npm run build       # tsc -p tsconfig.build.json → dist/
```

## License

[MIT](./LICENSE) © rdlabo-team
