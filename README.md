# @rdlabo/workers-hono-kit

Infrastructure toolkit for building APIs on [Hono](https://hono.dev) + [Cloudflare Workers](https://workers.cloudflare.com).

It provides the building blocks a NestJS-style API needs but that don't run on `workerd` (no Node.js AWS SDK, no `firebase-admin`), plus middleware that matches Express / NestJS response semantics byte-for-byte:

- **Firebase ID-token verification** on Workers via [`jose`](https://github.com/panva/jose) (RS256 against Google's securetoken JWKS), with optional Identity Toolkit REST for `getUser` / `deleteUser`.
- **AWS Secrets Manager** via SigV4-signed `fetch` ([`aws4fetch`](https://github.com/mhart/aws4fetch)) — no AWS SDK.
- **Middleware**: `finalizeResponse` (Express-compatible weak ETag + JSON charset), `validate` (NestJS `ValidationPipe`-shaped 400), and zod number-coercion helpers.
- **Deadlock retry** (`ER_LOCK_DEADLOCK` exponential backoff).
- **HTTP helpers**: `getUserProtocol`, `getAppInfo`, `HttpStatus`.

## Install

```bash
npm install @rdlabo/workers-hono-kit
```

Peer dependencies — install the ones you use:

```bash
npm install hono zod @hono/zod-validator jose aws4fetch
```

> **TypeScript sources, no build step.** The package is published as `.ts` via the `exports` field and is meant to be consumed by a bundler that compiles TypeScript — wrangler/esbuild, Vite, etc. — targeting `workerd` or another edge runtime. It relies only on Web-standard APIs (`fetch`, `crypto.subtle`, `Response`) available on Cloudflare Workers.

## API

| Export | Description |
| --- | --- |
| `finalizeResponse()` | Middleware that adds an Express-compatible weak `ETag` and JSON `charset=utf-8`. |
| `validate(target, schema, options?)` | Zod validator → NestJS `ValidationPipe`-shaped `400` (`{ statusCode, message[], error }`). `options.onValidationError(err, c)` to report (e.g. Sentry). |
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
| `HttpStatus` | HTTP status enum identical to NestJS `@nestjs/common`. |
| `createNestErrorHandler(options?)` / `NestErrorHandlerOptions` | `app.onError()` handler that maps a thrown `HTTPException` to the NestJS exception-filter body (`{ statusCode, message, error? }`; `401` omits `error`). Configurable field order, reason phrases, error predicate, and unhandled-error report hook. |
| `nestNotFoundHandler(c)` | `app.notFound()` handler with the Express/Nest default `{ message: 'Cannot METHOD path', error, statusCode }` 404 body. |
| `NEST_REASON_PHRASES` | `{ 400, 401, 403, 404 }` → NestJS reason phrases. |
| `createAuthMiddleware(options)` / `AuthMiddlewareOptions` | Factory for a Firebase-token auth middleware: reads the token header, verifies, resolves the DB user id, and stashes the result on the context. Omit `resolveUserId` for a token-only (login) guard. |
| `ErrorReporter` / `ErrorReportContext` | Types for a `container.reportError`-style unhandled-error reporter (e.g. wired to Sentry), paired with `createNestErrorHandler`'s `onUnhandledError`. |
| `KVCache` / `KVNamespace` / `KVCacheOptions` | Workers-KV cache-aside helper (key `appName+version+table_type_column`, sha256 for string ids, TTL clamped ≥60s). `appName`/`version` per repo. |
| `createStripeClient(secret, opts?)` / `verifyStripeWebhook(...)` / `CreateStripeClientOptions` | Workers-native Stripe client (fetch transport) + async webhook verification (SubtleCrypto). `apiVersion` optional (pin per `/api` parity). |

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
NestJS canonical shape (`{ statusCode, message, error? }`, `401` omits `error`); each repo
keeps its own byte-parity via options.

```ts
import { createNestErrorHandler, nestNotFoundHandler } from '@rdlabo/workers-hono-kit';

app.notFound(nestNotFoundHandler);
app.onError(createNestErrorHandler());

// Repo-specific parity deltas:
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
set context, with `console.error` + a configurable failure on error). Inject the repo's
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

### KV cache

```ts
import { KVCache } from '@rdlabo/workers-hono-kit';

const cache = new KVCache(env.CACHE, { appName: 'myapp' }); // version defaults to 'v8_'
await cache.set('users', 'byId', userId, user, 600);
const hit = await cache.get<User>('users', 'byId', userId);
```

### Stripe (Workers-native)

```ts
import { createStripeClient, verifyStripeWebhook } from '@rdlabo/workers-hono-kit';

const stripe = createStripeClient(secret); // or { apiVersion: '2024-04-10' } to pin
const event = await verifyStripeWebhook(secret, webhookSecret, rawBody, c.req.header('stripe-signature') ?? '');
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
```

## License

[MIT](./LICENSE) © rdlabo-team
