# @rdlabo/workers-hono-kit

Infrastructure toolkit for building APIs on [Hono](https://hono.dev) + [Cloudflare Workers](https://workers.cloudflare.com).

It provides the building blocks a NestJS-style API needs but that don't run on `workerd` (no Node.js AWS SDK, no `firebase-admin`), plus middleware that matches Express / NestJS response semantics byte-for-byte:

- **Firebase ID-token verification** on Workers via [`jose`](https://github.com/panva/jose) (RS256 against Google's securetoken JWKS), with optional Identity Toolkit REST for `getUser` / `deleteUser`.
- **AWS Secrets Manager** via SigV4-signed `fetch` ([`aws4fetch`](https://github.com/mhart/aws4fetch)) — no AWS SDK.
- **Middleware**: `finalizeResponse` (Express-compatible weak ETag + JSON charset), `validate` (NestJS `ValidationPipe`-shaped 400), and zod number-coercion helpers.
- **NestJS-shaped errors**: `createNestErrorHandler` / `nestNotFoundHandler` / `HttpStatus`.
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
> runtimes, and requires Node.js ≥ 20 for tooling. Three entry points are exposed:
>
> | Subpath | Import | Use |
> | --- | --- | --- |
> | `.` | `@rdlabo/workers-hono-kit` | Web-standard helpers (middleware, HTTP, Firebase, AWS, AI, Stripe, KV). |
> | `./db` | `@rdlabo/workers-hono-kit/db` | MySQL data layer (mysql2 + Drizzle). |
> | `./testing` | `@rdlabo/workers-hono-kit/testing` | Test helpers (mysql2 + Drizzle + fakes/fixtures). |

## API

### Root — `@rdlabo/workers-hono-kit`

| Export | Description |
| --- | --- |
| `finalizeResponse()` | Middleware that adds an Express-compatible weak `ETag` and JSON `charset=utf-8`. |
| `validate(target, schema, options?)` | Zod validator → NestJS `ValidationPipe`-shaped `400` (`{ statusCode, message[], error }`). `options.onValidationError(err, c)` to report (e.g. Sentry). |
| `createSentryValidate(sentry)` | Returns a `validate` variant that reports validation failures to an injected Sentry-like client (tags + context), avoiding a hard `@sentry/cloudflare` dependency. |
| `zNum` / `zNumWithDefault` / `zNumOptional` / `zNumNullable` | Number-coercion zod schemas (mirror class-transformer `@Transform`). |
| `getAuthenticationSecret<T>(options, secretId)` / `AwsSecretsOptions` | Fetch a secret from AWS Secrets Manager (SigV4 `fetch`, per-isolate cache). |
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
| `createNestErrorHandler(options?)` / `NestErrorHandlerOptions` | `app.onError()` handler that maps a thrown `HTTPException` to the NestJS exception-filter body (`{ statusCode, message, error? }`; `401` omits `error`). Configurable field order, reason phrases, error predicate, and unhandled-error report hook. |
| `nestNotFoundHandler(c)` | `app.notFound()` handler with the Express/Nest default `{ message: 'Cannot METHOD path', error, statusCode }` 404 body. |
| `normalizeTrailingSlash(request)` | Strip trailing slash(es) from the request URL before routing (Express/Nest parity). Does **not** 301-redirect — preserves POST/PUT/DELETE bodies. |
| `NEST_REASON_PHRASES` | `{ 400, 401, 403, 404 }` → NestJS reason phrases. |
| `createAuthMiddleware(options)` / `AuthMiddlewareOptions` | Factory for a Firebase-token auth middleware: reads the token header, verifies, resolves the DB user id, and stashes the result on the context. Omit `resolveUserId` for a token-only (login) guard. |
| `ErrorReporter` / `ErrorReportContext` | Types for a `reportError`-style unhandled-error reporter (e.g. wired to Sentry), paired with `createNestErrorHandler`'s `onUnhandledError`. |
| `createAiGatewayProvider(config)` / `AiGatewayConfig` / `AiGatewayProvider` | Route `@ai-sdk` models through the Cloudflare AI Gateway, via either a Workers `AI` binding or REST credentials (`accountId` / `gateway` / `token`). |
| `KVCache` / `KVNamespace` / `KVCacheOptions` | Workers-KV cache-aside helper (key `appName+version+table_type_column`, sha256 for string ids, TTL clamped ≥60s). Set `appName` / `version` per application. |
| `createStripeClient(secret, opts?)` / `verifyStripeWebhook(...)` / `CreateStripeClientOptions` | Workers-native Stripe client (fetch transport) + async webhook verification (SubtleCrypto). `apiVersion` optional (pin to a fixed Stripe API version). |
| `sendInChunks(queue, messages, chunkSize?)` / `QueueLike` / `QueueSendMessage` | Send queue messages in bounded chunks to stay under the Workers subrequest cap per invocation. |
| `processBatch(batch, handler, options?)` / `MessageBatchLike` / `QueueMessageLike` / `ProcessBatchOptions` / `ProcessBatchResult` | Process a queue batch with bounded concurrency (consumer-side counterpart to `sendInChunks`). |
| `ExecutionContextLike` | Minimal `waitUntil`-only Workers execution context shape (for `withMysqlConnections` in worker entry modules without importing `./db`). |

### Data layer — `@rdlabo/workers-hono-kit/db`

Requires the `drizzle-orm` and `mysql2` peers. Reads run against a replica via raw SQL; writes/transactions run against the primary through the Drizzle ORM with deadlock retry. The kit deliberately does not depend on the ORM's type identity — you pass the Drizzle instance in.

| Export | Description |
| --- | --- |
| `createHyperdriveDatabase(options)` | `DisposableDatabase` that lazily opens primary/replica connections from Hyperdrive bindings per request; `dispose()` closes them. |
| `createMysqlDatabase(options)` | Assemble a `Database` from an already-connected Drizzle ORM + replica `QueryRunner`. |
| `databaseFrom(orm, replica)` | Build a `Database` from an existing Drizzle instance + replica handle. |
| `Database` / `DisposableDatabase` / `QueryRunner` / `TxOf` | The `read` / `write` / `transaction` API and its supporting types. |
| `hyperdriveConnectionOptions(hyperdrive, overrides?)` / `HyperdriveLike` / `ExecutionContextLike` | Build mysql2 `createConnection` options from a Hyperdrive binding (`disableEval`, `decimalNumbers`, `timezone '+09:00'` by default). |
| `withMysqlConnections(...)` | Open primary/replica connections, run a function, close them in `finally` (via `ctx.waitUntil`). |
| `retryWhenDeadlock(fn, retries?, delay?)` | Same deadlock-retry helper as the root export. |
| `insertIdOf` / `affectedRowsOf` / `insertedIdsOf` / `DzWriteResult` | Extract `insertId` / `affectedRows` (and derive contiguous bulk-insert ids) from a mysql2 write result. |
| `toJstDate` / `jstTimestampParams` / `jstDatetimeParams` / `jstDateParams` | JST date/time normalization params（高度な用途）。 |
| `jstTimestamp` / `jstDatetime` / `jstDate` / `decimalNumber` | Drizzle 列ヘルパー（repo 側ラッパー不要）。 |
| `jstOnUpdateNow` | `ON UPDATE CURRENT_TIMESTAMP` 用 SQL 式。`jstTimestamp` 等の customType は `.onUpdateNow()` 非対応のため `.$onUpdateFn(() => jstOnUpdateNow(fsp))` と併用。 |
| `coerceDecimalNumber` / `decimalNumberParams` | DECIMAL 正規化 params（通常は `decimalNumber` 列ヘルパーで十分）。 |
| `DRIZZLE_ORM_OPTIONS` / `honoDrizzleConfig(options)` / `HonoDrizzleConfigOptions` | Shared Drizzle casing (`snake_case`) for both the runtime `drizzle()` call and `drizzle.config.ts`, keeping config ↔ runtime in sync. |
| `resolveDbSecret(options, secretId?)` / `ResolvedDbSecret` | Resolve RDS-managed or plain DB credentials from AWS Secrets Manager for CI migrate / local tooling. |
| `baselineMigrations(options)` / `readBaselineEntry(migrationsFolder)` / `BaselineMigrationsOptions` / `BaselineResult` / `BaselineEntry` | Brownfield first-deploy helper: mark an existing `0000_*` migration as applied without re-running DDL. |

#### Drizzle 列ヘルパー（`jstTimestamp` / `decimalNumber` 等）

- `drizzle-orm` は **peer** のみ。kit は `drizzle-orm` を依存に含めない（publish 後も consumer の 1 本を使う）。
- consumer は通常どおり `drizzle-orm` を `dependencies` に置くだけでよい。**`package.json` の `overrides` は不要**。
- npm publish 物には `devDependencies` は含まれないため、インストール先で kit 専用の `drizzle-orm` は増えない（peer の 1 本のみ）。
- 列ヘルパーは runtime で consumer の `drizzle-orm` を `import` する。型は `.default(sql\`…\`)` 連鎖のため declaration 上わざと緩い（`any`）。`$inferSelect` の列型は schema 定義側で維持される。
- `file:` で kit を直リンクする開発では、kit リポジトリ側で `npm install` して peer を満たす（consumer 側で overrides を足さない）。

**`CURRENT_TIMESTAMP` と接続 `timezone:'+09:00'` の違い**

| 経路 | 誰が時刻を決めるか | JST との関係 |
| --- | --- | --- |
| アプリが `Date` を bind（INSERT/UPDATE） | mysql2 + 接続 `timezone:'+09:00'` | ワイヤ上は JST として扱われる（`datetime-wire` テスト） |
| `DEFAULT CURRENT_TIMESTAMP` / `ON UPDATE CURRENT_TIMESTAMP` | MySQL サーバ（セッション `time_zone`） | 接続オプションとは**別経路**。RDS の `time_zone` が `+09:00` なら JST、UTC なら UTC |

`jstTimestamp` / `jstDatetime` は読書の pass-through と DATE 正規化のみ担当し、DB 既定値の時刻帯は変えない。`ON UPDATE` が必要な列は `.$onUpdateFn(() => jstOnUpdateNow(6))` で DDL 意図を維持する。

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

### Deadlock retry & HTTP helpers

```ts
import { retryWhenDeadlock, getUserProtocol, getAppInfo, HttpStatus } from '@rdlabo/workers-hono-kit';

await retryWhenDeadlock(() => db.transaction(/* ... */));

const { ipAddress, userAgent } = getUserProtocol(c);
const appInfo = getAppInfo(c);
return c.json(body, HttpStatus.CREATED);
```

### NestJS-shaped error / 404 handlers

`createNestErrorHandler()` renders a thrown `HTTPException` as the NestJS exception-filter
body, and `nestNotFoundHandler` gives the Express/Nest default 404. The defaults match the
NestJS canonical shape (`{ statusCode, message, error? }`, `401` omits `error`); the options
let you reproduce any byte-for-byte variation an existing API expects.

```ts
import { createNestErrorHandler, nestNotFoundHandler } from '@rdlabo/workers-hono-kit';

app.notFound(nestNotFoundHandler);
app.onError(createNestErrorHandler());

// Application-specific parity deltas:
app.onError(
  createNestErrorHandler({
    fieldOrder: 'message-first', // emit { message, error, statusCode } instead of statusCode-first
    onUnhandledError: (err, c) => container.reportError?.(err, { requestId: c.get('requestId') }),
    isHttpError: (e): e is HttpError => e instanceof HttpError, // a custom error class with a `.body` escape hatch
  }),
);
```

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
firebase.register('uid-1', { email: 'a@example.com' });

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
