import type { Context, Env } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * NestJS の既定例外フィルタが付ける reason phrase（フリート共通 = receptray/winecode/foodlabel の
 * REASON_PHRASE / DEFAULT_MESSAGES と同一）。3 repo がそれぞれ手書きしていたものを一本化する。
 */
export const NEST_REASON_PHRASES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
};

/** 想定外エラーの通報先に渡す文脈（request id 相関など）。フリート共通の最小形。 */
export interface ErrorReportContext {
  requestId?: string;
}

/**
 * 想定外エラーの通報関数（Sentry 等）の型。各 repo の container.reportError がこの形。
 * `createNestErrorHandler({ onUnhandledError })` に `(err, c) => reporter(err, { requestId: c.get('requestId') })`
 * の形で差し込む。Sentry 呼び出し自体は各 repo（@sentry/cloudflare は workers-hono-kit に持ち込まない）。
 */
export type ErrorReporter = (error: unknown, context?: ErrorReportContext) => void;

/** http エラーとみなされた値から status / message / body を読むための最小形。 */
interface HttpErrorLike {
  status: ContentfulStatusCode;
  message: string;
  /** repo 固有 body の脱出口（winecode の HttpError.body 相当）。あればそのまま render する。 */
  body?: unknown;
}

export interface NestErrorHandlerOptions<E extends Env = Env> {
  /** reason phrase map。既定 `NEST_REASON_PHRASES`。 */
  reasonPhrases?: Record<number, string>;
  /**
   * `error` フィールドを省いて `{ statusCode, message }` のみ返す status。既定 `[401]`
   * （NestJS の generic `HttpException(msg, 401)` は `error` を持たない）。
   */
  bareStatuses?: readonly number[];
  /**
   * 非 bare body のフィールド順序。既定 `'statusCode-first'`（= NestJS canonical / receptray・winecode）。
   * **foodlabel は `'message-first'`** を指定して `{ message, error, statusCode }` の byte-parity を保つ。
   */
  fieldOrder?: 'statusCode-first' | 'message-first';
  /**
   * reasonPhrases に無い（かつ bare でない）status の `error` フォールバック。既定 `undefined`
   * （= reason 無しなら `error` を省く）。**winecode は `'Error'`** を指定し、全 status で `error` を必ず出す
   * （NestJS 既定例外フィルタの「error は常に存在」を忠実再現）。
   */
  fallbackReason?: string;
  /**
   * http エラー判定。既定は hono の `HTTPException`。
   * **winecode は独自 `HttpError` を使う**ため `(e) => e instanceof HttpError` を渡す。
   */
  isHttpError?: (err: unknown) => err is HttpErrorLike;
  /**
   * http エラーでない（= 想定外）エラーを 500 で返す前に呼ぶフック（Sentry 通報など）。
   * **receptray は `container.reportError?.(err, { requestId })`** を差し込む。例外は握り潰す。
   */
  onUnhandledError?: (err: unknown, c: Context<E>) => void;
  /** 想定外エラー時の 500 body。既定 `{ statusCode: 500, message: 'Internal server error' }`。 */
  internalServerErrorBody?: unknown;
}

/**
 * hono の `HTTPException` を **構造的に**判定する（`instanceof` ではない）。workers-hono-kit は consumer に
 * symlink 同梱されるため、workers-hono-kit が解決する `hono` と consumer の `hono` が別インスタンスになり得る
 * （別コピーの HTTPException は `instanceof` で一致しない）。`getResponse()` と数値 `status` を持つかで
 * 判定すればモジュール境界をまたいでも、prod バンドルでも安定する。
 */
const isHTTPException = (err: unknown): err is HttpErrorLike =>
  err instanceof Error &&
  typeof (err as { getResponse?: unknown }).getResponse === 'function' &&
  typeof (err as { status?: unknown }).status === 'number';

/**
 * NestJS の例外フィルタ相当の Hono `onError` ハンドラを作る（フリート共通）。
 * - http エラー（既定 `HTTPException`）→ Nest 形 body にマップ。`body` を持つ場合はそれを verbatim で返す。
 * - bareStatuses（既定 401）は `error` フィールド無し。
 * - それ以外（想定外エラー）→ `onUnhandledError` 通報 + `console.error` + 500。
 *
 * `app.onError(createNestErrorHandler(...))` の形で使う。各 repo の parity 差異（body 順序・
 * エラー型・通報フック）は options で吸収し、本体の分岐ロジックは共有する。
 */
export function createNestErrorHandler<E extends Env = Env>(options: NestErrorHandlerOptions<E> = {}) {
  const {
    reasonPhrases = NEST_REASON_PHRASES,
    bareStatuses = [401],
    fieldOrder = 'statusCode-first',
    isHttpError = isHTTPException,
    onUnhandledError,
    internalServerErrorBody = { statusCode: 500, message: 'Internal server error' },
    fallbackReason,
  } = options;

  return (err: Error, c: Context<E>): Response => {
    if (isHttpError(err)) {
      // repo 固有 body の脱出口（winecode）。
      if (err.body !== undefined) {
        return c.json(err.body as object, err.status);
      }
      // reasonPhrases[status] は型上 string だが noUncheckedIndexedAccess 無効のため実際は未定義になり得る。
      // 未登録 status の fallbackReason フォールバックは意図的。
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const reason = bareStatuses.includes(err.status) ? undefined : (reasonPhrases[err.status] ?? fallbackReason);
      if (reason === undefined) {
        return c.json({ statusCode: err.status, message: err.message }, err.status);
      }
      const body =
        fieldOrder === 'message-first'
          ? { message: err.message, error: reason, statusCode: err.status }
          : { statusCode: err.status, message: err.message, error: reason };
      return c.json(body, err.status);
    }

    try {
      onUnhandledError?.(err, c);
    } catch {
      // 通報はエラーレスポンスの挙動を変えてはならない。
    }
    console.error(err);
    return c.json(internalServerErrorBody as object, 500);
  };
}

/**
 * Express/Nest 既定の未マッチルート 404 body を返す `notFound` ハンドラ。
 * `app.notFound(nestNotFoundHandler)` で使う（receptray/winecode は未実装の parity ギャップ）。
 */
export function nestNotFoundHandler(c: Context): Response {
  return c.json(
    { message: `Cannot ${c.req.method} ${new URL(c.req.url).pathname}`, error: 'Not Found', statusCode: 404 },
    404,
  );
}
