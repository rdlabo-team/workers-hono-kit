import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Normalized, provider-agnostic description of a failed Stripe payment.
 *
 * @remarks
 * Extracted from a Stripe `PaymentIntent`, `Invoice`, or a thrown `StripeCardError` by
 * {@link extractStripeFailureReason}. Fields are all optional because Stripe does not always populate
 * a decline reason (e.g. a Strong Customer Authentication challenge carries no `decline_code`).
 */
export interface StripeFailureReason {
  /** `last_payment_error.code`, e.g. `card_declined` / `authentication_required`. */
  code?: string;
  /** `last_payment_error.decline_code`, e.g. `insufficient_funds` / `expired_card`. */
  declineCode?: string;
  /** Stripe's original (English) failure message. Stored for debugging; never shown to users. */
  message?: string;
  /** Id of the PaymentIntent the failure originated from, when resolvable. */
  paymentIntentId?: string;
  /** Id of the Invoice the failure originated from, when resolvable. */
  invoiceId?: string;
  /** Id of the Subscription the failing invoice belongs to, when resolvable. */
  subscriptionId?: string;
}

/** Normalized reason persisted for an App Store / Google Play subscription failure. */
export interface IapFailureReason {
  /** Stable machine-readable classification. */
  code: 'billing_retry' | 'auto_renew_off' | 'subscription_canceled' | 'subscription_gone';
  /** Provider response status code when present (Apple verifyReceipt status / Google error code). */
  statusCode?: number;
  /** Apple auto-renew status (`'0'` means disabled). */
  autoRenewStatus?: string;
  /** Apple billing-retry status (`'1'` means retrying a failed renewal). */
  billingRetryStatus?: string;
  /** Google cancellation reason code (0=user, 1=system, 2=replaced, 3=developer). */
  cancelReason?: number;
}

/** Provider-specific diagnostic reason stored in `payment_failed.receipt`. */
export type PaymentFailureReason = StripeFailureReason | IapFailureReason;

/** Where a {@link PaymentFailureRecord} was captured. */
export type PaymentFailureSource =
  | 'webhook.invoice.payment_failed'
  | 'webhook.invoice.payment_action_required'
  | 'reconcile'
  | 'checkout'
  | 'iap';

/**
 * A payment failure as persisted to the `payment_failed.receipt` column (JSON string).
 *
 * @remarks
 * Only the raw {@link StripeFailureReason} is stored — the user-facing Japanese message is generated
 * on read via {@link stripeFailureMessageJa} so that wording changes never require a data migration.
 */
export interface PaymentFailureRecord {
  reason: PaymentFailureReason;
  /** Capture path. Optional for IAP because `payment_failed.type` already identifies the provider/path. */
  source?: PaymentFailureSource;
  /** ISO 8601 timestamp of when the failure was captured. */
  occurredAt?: string;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** Pull `{ code, decline_code, message }` out of a Stripe error-shaped object, or `null` if empty. */
function readErrorShape(v: unknown): Pick<StripeFailureReason, 'code' | 'declineCode' | 'message'> | null {
  const r = asRecord(v);
  if (!r) {
    return null;
  }
  const code = str(r.code);
  const declineCode = str(r.decline_code);
  const message = str(r.message);
  if (!code && !declineCode && !message) {
    return null;
  }
  return { code, declineCode, message };
}

/** Resolve a Stripe reference (id string or expanded object with an `id`) to its id string. */
function refId(v: unknown): string | undefined {
  if (typeof v === 'string') {
    return str(v);
  }
  return str(asRecord(v)?.id);
}

/**
 * Extract a normalized {@link StripeFailureReason} from a Stripe `PaymentIntent`, `Invoice`, a
 * `{ paymentIntent, invoice }` pair, or a thrown Stripe error.
 *
 * @remarks
 * The Stripe SDK is intentionally **not** imported — inputs are typed `unknown` and inspected by
 * duck typing (Stripe objects carry an `object` discriminator: `'payment_intent'` / `'invoice'`).
 * This keeps the helper immune to Stripe SDK version differences between this kit and its consumers,
 * matching the existing `isPermanentPaymentError` approach in the payment services.
 *
 * @param source - A PaymentIntent, Invoice, `{ paymentIntent?, invoice? }`, or thrown Stripe error.
 * @returns The extracted reason, or `null` when nothing identifiable could be found.
 */
export function extractStripeFailureReason(source: unknown): StripeFailureReason | null {
  const root = asRecord(source);
  if (!root) {
    return null;
  }

  let paymentIntent: Record<string, unknown> | null = null;
  let invoice: Record<string, unknown> | null = null;
  let thrown: Record<string, unknown> | null = null;

  if (root.paymentIntent !== undefined || root.invoice !== undefined) {
    // Normalized container: { paymentIntent?, invoice? }.
    paymentIntent = asRecord(root.paymentIntent);
    invoice = asRecord(root.invoice);
  } else if (str(root.object) === 'payment_intent') {
    paymentIntent = root;
  } else if (str(root.object) === 'invoice') {
    invoice = root;
  } else if (str(root.code) || str(root.decline_code) || root.type === 'StripeCardError') {
    // A thrown Stripe error; it may carry an expanded PaymentIntent.
    thrown = root;
    paymentIntent = asRecord(root.payment_intent);
  }

  // An invoice may embed its PaymentIntent (when expanded).
  if (invoice && !paymentIntent) {
    paymentIntent = asRecord(invoice.payment_intent);
  }

  const errorShape =
    readErrorShape(paymentIntent?.last_payment_error) ??
    readErrorShape(invoice?.last_finalization_error) ??
    (thrown ? readErrorShape(thrown) : null);

  const reason: StripeFailureReason = {
    code: errorShape?.code,
    declineCode: errorShape?.declineCode,
    message: errorShape?.message,
    paymentIntentId: refId(paymentIntent?.id ?? thrown?.payment_intent),
    invoiceId: refId(invoice?.id),
    subscriptionId: refId(invoice?.subscription),
  };

  // Strong Customer Authentication: no decline_code, but the intent is stuck on `requires_action`.
  if (!reason.code && !reason.declineCode && str(paymentIntent?.status) === 'requires_action') {
    reason.code = 'authentication_required';
  }

  const hasAny =
    reason.code ??
    reason.declineCode ??
    reason.message ??
    reason.paymentIntentId ??
    reason.invoiceId ??
    reason.subscriptionId;
  return hasAny ? reason : null;
}

const GENERIC_MESSAGE_JA = '前回のカード決済に失敗しました。カード情報をご確認のうえ、再度お試しください。';
const FRAUD_MESSAGE_JA =
  'カードがご利用いただけませんでした。カード会社にお問い合わせいただくか、別のカードをお試しください。';

/** decline_code → Japanese, taking precedence over {@link CODE_MESSAGES_JA}. */
const DECLINE_CODE_MESSAGES_JA: Record<string, string> = {
  insufficient_funds: '残高不足のためカードが承認されませんでした。別のカードをお試しください。',
  expired_card: 'カードの有効期限が切れています。カード情報を更新してください。',
  incorrect_cvc: 'セキュリティコード（CVC）が正しくありません。カード情報をご確認ください。',
  incorrect_number: 'カード番号が正しくありません。カード情報をご確認ください。',
  card_not_supported: 'このカードはご利用いただけません。別のカードをお試しください。',
  currency_not_supported: 'このカードは対象の通貨に対応していません。別のカードをお試しください。',
  card_velocity_exceeded: 'ご利用限度を超えたためカードが承認されませんでした。時間をおいて再度お試しください。',
  withdrawal_count_limit_exceeded:
    'ご利用限度を超えたためカードが承認されませんでした。時間をおいて再度お試しください。',
  processing_error: '決済処理中にエラーが発生しました。時間をおいて再度お試しください。',
  try_again_later: '一時的な理由でカードが承認されませんでした。時間をおいて再度お試しください。',
  // Fraud / security signals are collapsed to a generic message (Stripe recommends not revealing the reason).
  lost_card: FRAUD_MESSAGE_JA,
  stolen_card: FRAUD_MESSAGE_JA,
  pickup_card: FRAUD_MESSAGE_JA,
  do_not_honor: FRAUD_MESSAGE_JA,
  generic_decline: FRAUD_MESSAGE_JA,
  fraudulent: FRAUD_MESSAGE_JA,
};

/** last_payment_error.code → Japanese, used when no decline_code mapping matched. */
const CODE_MESSAGES_JA: Record<string, string> = {
  card_declined: FRAUD_MESSAGE_JA,
  expired_card: 'カードの有効期限が切れています。カード情報を更新してください。',
  incorrect_cvc: 'セキュリティコード（CVC）が正しくありません。カード情報をご確認ください。',
  incorrect_number: 'カード番号が正しくありません。カード情報をご確認ください。',
  processing_error: '決済処理中にエラーが発生しました。時間をおいて再度お試しください。',
  authentication_required: 'カード認証（3Dセキュア）が必要です。お手数ですが、もう一度お手続きをお願いします。',
};

/**
 * Render a {@link StripeFailureReason} as a single-sentence Japanese message safe to show to users.
 *
 * @remarks
 * `decline_code` wins over `code`; anything unmapped (including `null`) falls back to a generic
 * message. Fraud-related decline codes are deliberately masked with a generic phrase.
 *
 * @param reason - The extracted failure reason, or `null`.
 * @returns A user-facing Japanese message.
 */
export function stripeFailureMessageJa(reason: StripeFailureReason | null): string {
  if (!reason) {
    return GENERIC_MESSAGE_JA;
  }
  if (reason.declineCode && DECLINE_CODE_MESSAGES_JA[reason.declineCode]) {
    return DECLINE_CODE_MESSAGES_JA[reason.declineCode];
  }
  if (reason.code && CODE_MESSAGES_JA[reason.code]) {
    return CODE_MESSAGES_JA[reason.code];
  }
  return GENERIC_MESSAGE_JA;
}

/**
 * Serialize a {@link PaymentFailureRecord} for storage in the `payment_failed.receipt` column.
 *
 * @param record - The failure record to serialize.
 * @returns A JSON string.
 */
export function serializePaymentFailure(record: PaymentFailureRecord): string {
  return JSON.stringify(record);
}

/**
 * Parse a `payment_failed.receipt` value back into a {@link PaymentFailureRecord}.
 *
 * @param receipt - The stored JSON string, or `null`/`undefined`.
 * @returns The parsed record, or `null` when absent or malformed.
 */
export function parsePaymentFailure(receipt: string | null | undefined): PaymentFailureRecord | null {
  if (!receipt) {
    return null;
  }
  try {
    const parsed = JSON.parse(receipt) as unknown;
    const r = asRecord(parsed);
    if (
      !r ||
      !asRecord(r.reason) ||
      (r.source !== undefined && typeof r.source !== 'string') ||
      (r.occurredAt !== undefined && typeof r.occurredAt !== 'string')
    ) {
      return null;
    }
    return parsed as PaymentFailureRecord;
  } catch {
    return null;
  }
}

/** Response body carried by {@link PaymentDeclinedError}. */
export interface PaymentDeclinedBody {
  statusCode: number;
  /** User-facing Japanese message. */
  message: string;
  code?: string;
  declineCode?: string;
}

/**
 * HTTP error for a synchronous card decline, carrying a user-facing Japanese message.
 *
 * @remarks
 * Extends Hono's `HTTPException` and exposes a `body`, so `createHttpErrorHandler` returns that body
 * verbatim (see {@link createHttpErrorHandler}). Defaults to `400` rather than the semantically
 * correct `402` so it rides the fleet's existing client interceptor, which surfaces `4xx` bodies with
 * a `message` to the user.
 */
export class PaymentDeclinedError extends HTTPException {
  readonly body: PaymentDeclinedBody;

  constructor(reason: StripeFailureReason | null, status: ContentfulStatusCode = 400) {
    const message = stripeFailureMessageJa(reason);
    super(status, { message });
    this.body = { statusCode: status, message, code: reason?.code, declineCode: reason?.declineCode };
  }
}

/**
 * Convert a thrown Stripe error into a {@link PaymentDeclinedError}, or `null` when it is not a card
 * decline (the caller should re-throw so it maps to a generic 500).
 *
 * @param error - The value thrown by a Stripe SDK call.
 * @param status - HTTP status for the resulting error; defaults to `400` (see {@link PaymentDeclinedError}).
 * @returns A {@link PaymentDeclinedError}, or `null` when `error` is not a card decline.
 */
export function toPaymentDeclinedError(
  error: unknown,
  status: ContentfulStatusCode = 400,
): PaymentDeclinedError | null {
  const r = asRecord(error);
  if (!r) {
    return null;
  }
  const isCardError = r.type === 'StripeCardError' || !!str(r.decline_code) || str(r.code) === 'card_declined';
  if (!isCardError) {
    return null;
  }
  return new PaymentDeclinedError(extractStripeFailureReason(error), status);
}
